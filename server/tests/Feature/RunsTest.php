<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RunsTest extends TestCase
{
    use RefreshDatabase;

    /** @return array<string, mixed> */
    private function cityRun(string $uid = 'arena-1', float $impact = 3.0): array
    {
        return [
            'uid' => $uid,
            'game' => 'city',
            'seed' => 8,
            'model' => 'test-model',
            'provider' => 'stub',
            'impact' => $impact,
            'efficiency' => 0.5,
        ];
    }

    public function test_store_city_run_returns_position(): void
    {
        $response = $this->postJson('/api/runs', $this->cityRun());

        $response->assertCreated()->assertJson(['position' => 1]);
    }

    public function test_store_city_run_requires_city_metrics(): void
    {
        $payload = $this->cityRun();
        unset($payload['impact'], $payload['efficiency']);

        $this->postJson('/api/runs', $payload)->assertUnprocessable();
    }

    public function test_store_tote_run_requires_score(): void
    {
        $payload = [
            'uid' => 'arena-1',
            'game' => 'tote',
            'seed' => 3,
            'model' => 'test-model',
            'provider' => 'stub',
        ];

        $response = $this->postJson('/api/runs', $payload);
        $response->assertUnprocessable();

        $payload['score'] = 7.5;
        $this->postJson('/api/runs', $payload)
            ->assertCreated()
            ->assertJson(['position' => 1]);
    }

    public function test_leaderboard_orders_by_metric_and_reports_you(): void
    {
        $this->postJson('/api/runs', $this->cityRun('arena-low', 1.0));
        $this->postJson('/api/runs', $this->cityRun('arena-high', 5.0));
        $this->postJson('/api/runs', $this->cityRun('arena-mid', 3.0));

        $response = $this->getJson('/api/leaderboard?game=city&metric=impact&uid=arena-mid');

        $response->assertOk();
        $board = $response->json('board');
        $this->assertSame(['arena-high', 'arena-mid', 'arena-low'], array_column($board, 'uid'));
        $this->assertSame([1, 2, 3], array_column($board, 'position'));
        $this->assertSame(2, $response->json('you.position'));
        $this->assertSame('arena-mid', $response->json('you.uid'));
    }

    public function test_leaderboard_rejects_metric_from_other_game(): void
    {
        $this->getJson('/api/leaderboard?game=tote&metric=impact')
            ->assertUnprocessable();
    }

    public function test_leaderboard_caps_limit(): void
    {
        $this->getJson('/api/leaderboard?game=city&metric=impact&limit=500')
            ->assertUnprocessable();
    }

    public function test_store_accepts_optional_nickname(): void
    {
        $payload = $this->cityRun();
        $payload['nickname'] = 'Rusty';

        $this->postJson('/api/runs', $payload)->assertCreated();
        $this->assertDatabaseHas('runs', ['uid' => 'arena-1', 'nickname' => 'Rusty']);
    }

    public function test_leaderboard_returns_nicknames(): void
    {
        $named = $this->cityRun('arena-named', 5.0);
        $named['nickname'] = 'Rusty';
        $this->postJson('/api/runs', $named);
        $this->postJson('/api/runs', $this->cityRun('arena-plain', 4.0));

        $response = $this->getJson('/api/leaderboard?game=city&metric=impact');

        $response->assertOk();
        $board = $response->json('board');
        $this->assertSame('Rusty', $board[0]['nickname']);
        $this->assertNull($board[1]['nickname']);
    }

    public function test_store_rejects_overlong_nickname(): void
    {
        $payload = $this->cityRun();
        $payload['nickname'] = str_repeat('x', 33);

        $this->postJson('/api/runs', $payload)->assertUnprocessable();
    }

    public function test_store_accepts_badges_and_strategy(): void
    {
        $payload = $this->cityRun();
        $payload['badges'] = ['clean_sheet', 'green_shift'];
        $payload['strategy'] = ['played_turns' => 12, 'policies' => ['curfew' => 1]];

        $this->postJson('/api/runs', $payload)->assertCreated();
        $this->assertDatabaseHas('runs', [
            'uid' => 'arena-1',
            'badges' => json_encode(['clean_sheet', 'green_shift']),
        ]);
    }

    public function test_leaderboard_returns_badges_with_null_fallback(): void
    {
        $badged = $this->cityRun('arena-badged', 5.0);
        $badged['badges'] = ['clean_sheet'];
        $this->postJson('/api/runs', $badged);
        $this->postJson('/api/runs', $this->cityRun('arena-plain', 4.0));

        $response = $this->getJson('/api/leaderboard?game=city&metric=impact');

        $response->assertOk();
        $board = $response->json('board');
        $this->assertSame(['clean_sheet'], $board[0]['badges']);
        $this->assertNull($board[1]['badges']);
    }

    public function test_store_rejects_non_array_badges(): void
    {
        $payload = $this->cityRun();
        $payload['badges'] = 'clean_sheet';

        $this->postJson('/api/runs', $payload)->assertUnprocessable();
    }

    public function test_store_rejects_bloated_strategy_and_details(): void
    {
        $wide = $this->cityRun();
        $wide['strategy'] = array_fill(0, 9, 1.0);

        $this->postJson('/api/runs', $wide)->assertUnprocessable();

        $deep = $this->cityRun('arena-2');
        $deep['details'] = ['blob' => str_repeat('x', 9000)];

        $this->postJson('/api/runs', $deep)->assertUnprocessable();
    }

    /** @return array<string, mixed> */
    private function fingerprint(array $means): array
    {
        return [
            'mean_allocation' => $means,
            'policies' => [],
            'played_turns' => 12,
            'skipped_turns' => 0,
        ];
    }

    /** @return array<string, float> */
    private function balancedMeans(): array
    {
        return [
            'housing' => 15.0,
            'transit' => 10.0,
            'health' => 15.0,
            'green' => 10.0,
            'reserves' => 15.0,
            'rescue' => 12.0,
            'shelter' => 11.0,
            'repair' => 12.0,
        ];
    }

    public function test_leaderboard_scopes_by_challenge(): void
    {
        $debut = $this->cityRun('arena-debut', 9.0);
        $debut['challenge'] = 'debut';
        $this->postJson('/api/runs', $debut);
        $this->postJson('/api/runs', $this->cityRun('arena-open', 1.0));

        $scoped = $this->getJson('/api/leaderboard?game=city&metric=impact&challenge=debut');
        $scoped->assertOk();
        $this->assertSame(['arena-debut'], array_column($scoped->json('board'), 'uid'));
        $this->assertSame('debut', $scoped->json('board.0.challenge'));

        $open = $this->getJson('/api/leaderboard?game=city&metric=impact');
        $open->assertOk();
        $this->assertSame(['arena-open'], array_column($open->json('board'), 'uid'));
        $this->assertNull($open->json('board.0.challenge'));
    }

    public function test_store_position_is_challenge_scoped(): void
    {
        $this->postJson('/api/runs', $this->cityRun('arena-open', 100.0));
        $debut = $this->cityRun('arena-debut', 1.0);
        $debut['challenge'] = 'debut';

        $response = $this->postJson('/api/runs', $debut);
        $response->assertCreated();
        $this->assertSame(1, $response->json('position'));
    }

    public function test_diversity_penalty_drops_clustered_leader(): void
    {
        $means = $this->balancedMeans();
        $loner = $means;
        $loner['housing'] = 60.0;
        $loner['reserves'] = 0.0;
        $loner['transit'] = 0.0;
        $loner['green'] = 0.0;
        $rows = [
            ['arena-a', 10.0, $means],
            ['arena-b', 9.8, $means],
            ['arena-c', 9.7, $means],
            ['arena-d', 9.6, $means],
            ['arena-e', 9.6, $loner],
        ];
        foreach ($rows as [$uid, $impact, $alloc]) {
            $payload = $this->cityRun($uid, $impact);
            $payload['strategy'] = $this->fingerprint($alloc);
            $this->postJson('/api/runs', $payload)->assertCreated();
        }

        $board = $this->getJson('/api/leaderboard?game=city&metric=impact')->json('board');
        $this->assertSame('arena-e', $board[0]['uid']);
        $this->assertEquals(0.0, $board[0]['diversity_penalty']);
        $this->assertSame('arena-a', $board[1]['uid']);
        $this->assertSame(0.5, $board[1]['diversity_penalty']);
    }

    public function test_small_population_has_no_diversity_penalty(): void
    {
        for ($i = 0; $i < 4; $i++) {
            $payload = $this->cityRun("arena-{$i}", 5.0 - $i * 0.1);
            $payload['strategy'] = $this->fingerprint($this->balancedMeans());
            $this->postJson('/api/runs', $payload)->assertCreated();
        }

        $board = $this->getJson('/api/leaderboard?game=city&metric=impact')->json('board');
        foreach ($board as $row) {
            $this->assertEquals(0.0, $row['diversity_penalty']);
        }
    }

    public function test_badge_boost_rewards_badges_from_prior_runs(): void
    {
        $first = $this->cityRun('arena-x', 5.0);
        $first['badges'] = ['clean_sheet'];
        $this->postJson('/api/runs', $first);
        $second = $this->cityRun('arena-x', 5.0);
        $second['badges'] = [];
        $this->postJson('/api/runs', $second);

        $board = $this->getJson('/api/leaderboard?game=city&metric=impact')->json('board');
        $this->assertSame(0.25, $board[0]['badge_boost']);
        $this->assertEquals(0.0, $board[1]['badge_boost']);
    }

    public function test_badge_boost_caps_at_one_point(): void
    {
        $first = $this->cityRun('arena-y', 1.0);
        $first['badges'] = ['a', 'b', 'c', 'd', 'e'];
        $this->postJson('/api/runs', $first);
        $this->postJson('/api/runs', $this->cityRun('arena-y', 1.0));

        $board = $this->getJson('/api/leaderboard?game=city&metric=impact')->json('board');
        $this->assertEquals(1.0, $board[0]['badge_boost']);
    }
}
