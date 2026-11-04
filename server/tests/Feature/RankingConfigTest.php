<?php

namespace Tests\Feature;

use App\Models\ChallengeProposal;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RankingConfigTest extends TestCase
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

    public function test_vote_weight_reads_config(): void
    {
        // Four stronger bots keep arena-x out of the top-three bonus,
        // so the weight isolates the base knob.
        $this->postJson('/api/runs', $this->cityRun('arena-a', 9.0));
        $this->postJson('/api/runs', $this->cityRun('arena-b', 8.0));
        $this->postJson('/api/runs', $this->cityRun('arena-c', 7.0));
        $this->postJson('/api/runs', $this->cityRun('arena-d', 6.0));
        $this->postJson('/api/runs', $this->cityRun('arena-x', 3.0));
        $proposal = ChallengeProposal::create([
            'uid' => 'arena-x',
            'title' => 'Config drill',
            'description' => 'Knob check.',
            'model' => 'm',
            'input_prompt' => 'p',
            'output_format' => 'f',
        ]);

        config(['arena.ranking.vote_base' => 2.0]);
        $vote = $this->postJson(
            "/api/challenges/proposals/{$proposal->id}/votes",
            ['uid' => 'arena-x']
        );
        $vote->assertCreated();
        $this->assertEquals(2.0, $vote->json('weight'));
    }

    public function test_diversity_penalty_reads_config(): void
    {
        $fingerprint = ['mean_allocation' => [
            'housing' => 10, 'transit' => 10, 'health' => 10, 'green' => 10,
            'reserves' => 10, 'rescue' => 10, 'shelter' => 10, 'repair' => 10,
        ]];
        for ($i = 1; $i <= 5; $i++) {
            $this->postJson(
                '/api/runs',
                $this->cityRun("arena-c{$i}", (float) $i, $fingerprint)
            )->assertCreated();
        }

        // Five identical fingerprints cluster, so the default 0.5 binds.
        $board = $this->getJson('/api/leaderboard?game=city&metric=impact');
        $board->assertOk();
        $this->assertEquals(0.5, $board->json('board.0.diversity_penalty'));

        config(['arena.ranking.diversity_penalty' => 2.0]);
        $retuned = $this->getJson('/api/leaderboard?game=city&metric=impact');
        $retuned->assertOk();
        $this->assertEquals(2.0, $retuned->json('board.0.diversity_penalty'));
    }
}
