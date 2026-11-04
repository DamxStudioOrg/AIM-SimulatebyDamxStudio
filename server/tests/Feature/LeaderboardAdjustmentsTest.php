<?php

namespace Tests\Feature;

use App\Http\Controllers\LeaderboardController;
use App\Models\Run;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Leaderboard adjustment integrity: badge data loads in one query,
 * and city rows without fingerprints impute neutral instead of
 * dodging the diversity check.
 */
class LeaderboardAdjustmentsTest extends TestCase
{
    use RefreshDatabase;

    /** @return array<string, mixed> */
    private function cityRun(string $uid, float $impact, ?array $strategy = null): array
    {
        $run = [
            'uid' => $uid,
            'game' => 'city',
            'seed' => 8,
            'model' => 'test-model',
            'provider' => 'stub',
            'impact' => $impact,
            'efficiency' => 0.5,
        ];
        if ($strategy !== null) {
            $run['strategy'] = $strategy;
        }

        return $run;
    }

    public function test_badge_pool_loads_in_constant_queries(): void
    {
        for ($i = 1; $i <= 10; $i++) {
            Run::create($this->cityRun("arena-{$i}", (float) $i));
        }

        DB::enableQueryLog();
        try {
            $entries = LeaderboardController::rankedPool('city', null, 'impact');
        } finally {
            $queries = DB::getQueryLog();
            DB::disableQueryLog();
        }

        $this->assertCount(10, $entries);
        // Pool query plus one badge preload — never one per run.
        $this->assertLessThanOrEqual(3, count($queries));
    }

    public function test_badge_boost_still_counts_prior_badges(): void
    {
        $first = $this->cityRun('decorated', 2.0);
        $first['badges'] = ['early', 'often'];
        Run::create($first);
        Run::create($this->cityRun('decorated', 3.0));

        $entries = LeaderboardController::rankedPool('city', null, 'impact');
        $boosts = [];
        foreach ($entries as $entry) {
            $boosts[] = $entry['badge_boost'];
        }
        sort($boosts);

        // First row earns nothing; the second banks two prior badges.
        $this->assertSame([0.0, 0.5], $boosts);
    }

    public function test_missing_city_fingerprints_impute_neutral(): void
    {
        for ($i = 1; $i <= 5; $i++) {
            Run::create($this->cityRun("arena-{$i}", 10.0 + $i));
        }

        $response = $this->getJson('/api/leaderboard?game=city&metric=impact');

        $response->assertOk();
        // Five identical neutral vectors cluster, so the default 0.5 binds.
        foreach ($response->json('board') as $row) {
            $this->assertEquals(0.5, $row['diversity_penalty']);
        }
        $this->assertEquals(15.0, $response->json('board.0.impact'));
    }

    public function test_tote_rows_skip_diversity_entirely(): void
    {
        for ($i = 1; $i <= 5; $i++) {
            Run::create([
                'uid' => "packer-{$i}",
                'game' => 'tote',
                'seed' => 4,
                'model' => 'test-model',
                'provider' => 'stub',
                'score' => 80.0 + $i,
            ]);
        }

        $response = $this->getJson('/api/leaderboard?game=tote&metric=score');

        $response->assertOk();
        foreach ($response->json('board') as $row) {
            $this->assertEquals(0.0, $row['diversity_penalty']);
        }
        $this->assertEquals(85.0, $response->json('board.0.score'));
    }
}
