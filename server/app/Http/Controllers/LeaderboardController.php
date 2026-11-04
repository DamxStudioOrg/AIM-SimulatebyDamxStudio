<?php

namespace App\Http\Controllers;

use App\Models\Run;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

class LeaderboardController extends Controller
{
    public const DEFAULT_LIMIT = 10;

    public const MAX_LIMIT = 50;

    // Placeholder knobs for diversity/badge adjustments. Population stats
    // are computed from stored fingerprints; tune once real data lands.
    // Constants are the shipped defaults; config/arena.php tunes live.
    public const DIVERSITY_MIN_POPULATION = 5;

    public const DIVERSITY_RADIUS = 10.0;

    public const DIVERSITY_CLUSTER_MIN = 3;

    public const DIVERSITY_PENALTY = 0.5;

    public const BADGE_BOOST_EACH = 0.25;

    public const BADGE_BOOST_MAX = 1.0;

    public const ADJUSTMENT_POOL_MAX = 500;

    public const ALLOCATION_KEYS = [
        'housing',
        'transit',
        'health',
        'green',
        'reserves',
        'rescue',
        'shelter',
        'repair',
    ];

    /**
     * Top runs for a game + metric + challenge scope. Pass ?uid= to include
     * the caller's best row and position alongside the board.
     */
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'game' => 'required|string|in:city,tote',
            'metric' => 'required|string',
            'challenge' => 'nullable|string|max:64',
            'limit' => 'nullable|integer|min:1|max:'.self::MAX_LIMIT,
            'uid' => 'nullable|string|max:128',
        ]);

        $metrics = Run::metricsFor($validated['game']);
        if (! in_array($validated['metric'], $metrics, true)) {
            return response()->json([
                'message' => 'Metric must be one of: '.implode(', ', $metrics ?? []),
            ], 422);
        }

        $metric = $validated['metric'];
        $challenge = $validated['challenge'] ?? null;
        $limit = $validated['limit'] ?? self::DEFAULT_LIMIT;
        $ranked = self::rankedPool($validated['game'], $challenge, $metric);

        $board = [];
        foreach (array_slice($ranked, 0, $limit) as $index => $entry) {
            $board[] = $this->rowFor($entry['run'], $metric, $index + 1, $entry);
        }

        $payload = ['board' => $board];
        if (! empty($validated['uid'])) {
            $payload['you'] = $this->bestFor($ranked, $validated['uid'], $metric);
        }

        return response()->json($payload);
    }

    /** Standard competition rank on the adjusted metric within the scope. */
    public static function positionFor(Run $run, string $metric): int
    {
        $ranked = self::rankedPool($run->game, $run->challenge, $metric);
        $mine = null;
        foreach ($ranked as $entry) {
            if ($entry['run']->id === $run->id) {
                $mine = $entry['adjusted'];
                break;
            }
        }
        if ($mine === null) {
            return count($ranked) + 1;
        }
        $better = 0;
        foreach ($ranked as $entry) {
            if ($entry['adjusted'] > $mine) {
                $better++;
            }
        }

        return $better + 1;
    }

    /**
     * Scope a run query to one challenge. Null, empty, and "open" all mean
     * the open-prompt scope, which also holds legacy rows without a value.
     */
    private static function scopeChallenge(Builder $query, ?string $challenge): Builder
    {
        if ($challenge === null || $challenge === '' || $challenge === 'open') {
            return $query->whereNull('challenge');
        }

        return $query->where('challenge', $challenge);
    }

    /**
     * Pool entries sorted by adjusted metric, oldest first on ties.
     * Public for vote weighting, which ranks on the same numbers.
     *
     * @return list<array{run: Run, adjusted: float, diversity_penalty: float, badge_boost: float}>
     */
    public static function rankedPool(string $game, ?string $challenge, string $metric): array
    {
        // Placeholder exactness: beyond ADJUSTMENT_POOL_MAX rows the tail is
        // cut before adjusting, so deep positions are approximate.
        $runs = self::scopeChallenge(Run::where('game', $game), $challenge)
            ->whereNotNull($metric)
            ->orderByDesc($metric)
            ->orderBy('created_at')
            ->limit((int) config('arena.ranking.adjustment_pool_max', self::ADJUSTMENT_POOL_MAX))
            ->get();

        $penalties = self::diversityPenalties($runs);
        // One badge lookup for the whole pool: the old per-run query
        // fanned out into N+1 on every submission and vote.
        $priorBadges = self::preloadPriorBadges($runs);
        $entries = [];
        foreach ($runs as $run) {
            $boost = self::badgeBoost($run, $priorBadges);
            $raw = (float) $run->{$metric};
            $entries[] = [
                'run' => $run,
                'adjusted' => $raw - $penalties[$run->id] + $boost,
                'diversity_penalty' => $penalties[$run->id],
                'badge_boost' => $boost,
            ];
        }
        usort($entries, function (array $a, array $b): int {
            if ($a['adjusted'] !== $b['adjusted']) {
                return $b['adjusted'] <=> $a['adjusted'];
            }

            return $a['run']->created_at <=> $b['run']->created_at;
        });

        return $entries;
    }

    /** @param Collection<int, Run> $runs @return array<int, float> */
    private static function diversityPenalties($runs): array
    {
        $vectors = [];
        foreach ($runs as $run) {
            $vector = self::allocationVector($run);
            if ($vector !== null) {
                $vectors[$run->id] = $vector;
            }
        }
        $penalties = [];
        foreach ($runs as $run) {
            $penalties[$run->id] = 0.0;
        }
        if (count($vectors) < (int) config('arena.ranking.diversity_min_population', self::DIVERSITY_MIN_POPULATION)) {
            return $penalties;
        }
        $radius = (float) config('arena.ranking.diversity_radius', self::DIVERSITY_RADIUS);
        $clusterMin = (int) config('arena.ranking.diversity_cluster_min', self::DIVERSITY_CLUSTER_MIN);
        $penalty = (float) config('arena.ranking.diversity_penalty', self::DIVERSITY_PENALTY);
        foreach ($vectors as $id => $vector) {
            $neighbors = 0;
            foreach ($vectors as $otherId => $other) {
                if ($otherId !== $id && self::distance($vector, $other) <= $radius) {
                    $neighbors++;
                }
            }
            if ($neighbors >= $clusterMin) {
                $penalties[$id] = $penalty;
            }
        }

        return $penalties;
    }

    /** @return list<float>|null */
    private static function allocationVector(Run $run): ?array
    {
        if ($run->game !== 'city') {
            return null;
        }
        $strategy = $run->strategy;
        $mean = is_array($strategy) ? ($strategy['mean_allocation'] ?? null) : null;
        $vector = [];
        foreach (self::ALLOCATION_KEYS as $key) {
            $value = is_array($mean) ? ($mean[$key] ?? null) : null;
            if (! is_numeric($value)) {
                // Missing or partial fingerprints impute neutral (an
                // even 100-point split): stripped rows cluster with
                // each other instead of dodging the diversity check.
                return array_fill(0, 8, 12.5);
            }
            $vector[] = (float) $value;
        }

        return $vector;
    }

    /** @param list<float> $a @param list<float> $b */
    private static function distance(array $a, array $b): float
    {
        $sum = 0.0;
        foreach ($a as $index => $value) {
            $sum += ($value - $b[$index]) ** 2;
        }

        return sqrt($sum);
    }

    /**
     * Prior badge sets per run id in one query: distinct badges from
     * earlier rows of the same game+uid, exactly like the old
     * per-run lookup. Rows outside the pool still count.
     *
     * @param Collection<int, Run> $runs
     * @return array<int, array<string, true>>
     */
    private static function preloadPriorBadges($runs): array
    {
        $uids = $runs->pluck('uid')->unique()->values()->all();
        $games = $runs->pluck('game')->unique()->values()->all();
        if ($uids === [] || $games === []) {
            return [];
        }
        $rows = Run::whereIn('game', $games)->whereIn('uid', $uids)
            ->orderBy('id')->get(['id', 'game', 'uid', 'badges']);
        $seen = [];
        $prior = [];
        foreach ($rows as $row) {
            $key = $row->game."\0".$row->uid;
            $prior[$row->id] = $seen[$key] ?? [];
            foreach ((array) ($row->badges ?? []) as $badge) {
                $seen[$key][$badge] = true;
            }
        }

        return $prior;
    }

    /** @param array<int, array<string, true>> $preloaded */
    private static function badgeBoost(Run $run, array $preloaded): float
    {
        $distinct = count($preloaded[$run->id] ?? []);

        return min(
            $distinct * (float) config('arena.ranking.badge_boost_each', self::BADGE_BOOST_EACH),
            (float) config('arena.ranking.badge_boost_max', self::BADGE_BOOST_MAX)
        );
    }

    /** @return array<string, mixed> */
    private function rowFor(Run $run, string $metric, int $position, array $entry): array
    {
        return [
            'position' => $position,
            'uid' => $run->uid,
            'game' => $run->game,
            'challenge' => $run->challenge,
            'seed' => $run->seed,
            'model' => $run->model,
            'provider' => $run->provider,
            'nickname' => $run->nickname,
            'badges' => $run->badges,
            'strategy' => $run->strategy,
            'diversity_penalty' => $entry['diversity_penalty'],
            'badge_boost' => $entry['badge_boost'],
            $metric => $run->{$metric},
            'created_at' => $run->created_at?->toIso8601String(),
        ];
    }

    /**
     * @param  list<array{run: Run, adjusted: float, diversity_penalty: float, badge_boost: float}>  $ranked
     * @return array<string, mixed>|null
     */
    private function bestFor(array $ranked, string $uid, string $metric): ?array
    {
        foreach ($ranked as $index => $entry) {
            if ($entry['run']->uid === $uid) {
                $better = 0;
                foreach ($ranked as $other) {
                    if ($other['adjusted'] > $entry['adjusted']) {
                        $better++;
                    }
                }

                return $this->rowFor($entry['run'], $metric, $better + 1, $entry);
            }
        }

        return null;
    }
}
