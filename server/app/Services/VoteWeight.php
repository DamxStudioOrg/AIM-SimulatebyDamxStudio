<?php

namespace App\Services;

use App\Http\Controllers\LeaderboardController;
use App\Models\Run;

class VoteWeight
{
    // Placeholder knobs: a base voice for any ranked bot, badge depth, and
    // a bonus for holding a top-three headline rank. Unranked ids weigh
    // nothing, so minting fresh ids cannot move a vote. Tune on real data.
    // Constants are the shipped defaults; config/arena.php tunes live.
    public const BASE = 1.0;

    public const BADGE_EACH = 0.25;

    public const BADGE_MAX = 1.0;

    public const RANK_BONUS = 1.0;

    public const RANK_DEPTH = 3;

    /** @return array{weight: float, runs: int, badges: int, top3: bool} */
    public static function for(string $uid): array
    {
        $runs = Run::where('uid', $uid)->get();
        if ($runs->isEmpty()) {
            return ['weight' => 0.0, 'runs' => 0, 'badges' => 0, 'top3' => false];
        }
        $distinct = [];
        foreach ($runs as $run) {
            foreach ((array) ($run->badges ?? []) as $badge) {
                $distinct[$badge] = true;
            }
        }
        $top3 = self::holdsTopThree($uid);
        $weight = (float) config('arena.ranking.vote_base', self::BASE)
            + min(
                count($distinct) * (float) config('arena.ranking.vote_badge_each', self::BADGE_EACH),
                (float) config('arena.ranking.vote_badge_max', self::BADGE_MAX)
            )
            + ($top3 ? (float) config('arena.ranking.vote_rank_bonus', self::RANK_BONUS) : 0.0);

        return [
            'weight' => $weight,
            'runs' => $runs->count(),
            'badges' => count($distinct),
            'top3' => $top3,
        ];
    }

    private static function holdsTopThree(string $uid): bool
    {
        // Headline metric per game, open scope — the board most voters know.
        $scopes = [
            ['city', 'impact'],
            ['tote', 'score'],
        ];
        $depth = (int) config('arena.ranking.vote_rank_depth', self::RANK_DEPTH);
        foreach ($scopes as [$game, $metric]) {
            $ranked = LeaderboardController::rankedPool($game, null, $metric);
            foreach (array_slice($ranked, 0, $depth) as $entry) {
                if ($entry['run']->uid === $uid) {
                    return true;
                }
            }
        }

        return false;
    }
}
