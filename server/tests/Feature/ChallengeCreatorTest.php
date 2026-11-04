<?php

namespace Tests\Feature;

use App\Models\ChallengeProposal;
use App\Models\ChallengeVote;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ChallengeCreatorTest extends TestCase
{
    use RefreshDatabase;

    /** @return array<string, mixed> */
    private function proposal(string $uid = 'arena-1'): array
    {
        return [
            'uid' => $uid,
            'nickname' => 'Rusty',
            'title' => 'Blackout drill',
            'description' => 'A heatwave knocks out clinics for three turns.',
            'model' => 'ollama/hermes3:8b',
            'input_prompt' => 'Keep the lights on with half the budget.',
            'output_format' => 'JSON allocations per turn',
            'restrictions' => 'No rescue spend before turn 6.',
        ];
    }

    /** @return array<string, mixed> */
    private function cityRun(string $uid, float $impact = 3.0, array $badges = []): array
    {
        return [
            'uid' => $uid,
            'game' => 'city',
            'seed' => 8,
            'model' => 'test-model',
            'provider' => 'stub',
            'impact' => $impact,
            'efficiency' => 0.5,
            'badges' => $badges,
        ];
    }

    public function test_propose_requires_brief_fields(): void
    {
        $payload = $this->proposal();
        unset($payload['model'], $payload['input_prompt'], $payload['output_format']);

        $this->postJson('/api/challenges/proposals', $payload)->assertUnprocessable();
    }

    public function test_propose_and_list_round_trip(): void
    {
        $this->postJson('/api/challenges/proposals', $this->proposal())
            ->assertCreated()
            ->assertJsonPath('title', 'Blackout drill');

        $this->getJson('/api/challenges/proposals')
            ->assertOk()
            ->assertJsonPath('proposals.0.title', 'Blackout drill')
            ->assertJsonPath('proposals.0.weighted_votes', 0)
            ->assertJsonPath('proposals.0.featured', false);
    }

    public function test_unranked_uid_cannot_vote(): void
    {
        $proposal = ChallengeProposal::create($this->proposal());

        $this->postJson("/api/challenges/proposals/{$proposal->id}/votes", ['uid' => 'arena-new'])
            ->assertUnprocessable()
            ->assertJsonPath('error', 'Play a match before voting.');
    }

    public function test_vote_weight_grows_with_badges(): void
    {
        $this->postJson('/api/runs', $this->cityRun('arena-top1', 9.0));
        $this->postJson('/api/runs', $this->cityRun('arena-top2', 8.0));
        $this->postJson('/api/runs', $this->cityRun('arena-top3', 7.0));
        $this->postJson('/api/runs', $this->cityRun('arena-plain', 3.0));
        $this->postJson('/api/runs', $this->cityRun('arena-decorated', 2.0, ['a', 'b']));
        $proposal = ChallengeProposal::create($this->proposal());

        // Floats ride JSON as numbers: 1.0 encodes to 1, so compare loosely.
        $plain = $this->postJson("/api/challenges/proposals/{$proposal->id}/votes", ['uid' => 'arena-plain']);
        $plain->assertCreated();
        $this->assertEquals(1.0, $plain->json('weight'));
        $decorated = $this->postJson("/api/challenges/proposals/{$proposal->id}/votes", ['uid' => 'arena-decorated']);
        $decorated->assertCreated();
        $this->assertEquals(1.5, $decorated->json('weight'));
    }

    public function test_duplicate_vote_conflicts(): void
    {
        $this->postJson('/api/runs', $this->cityRun('arena-1'));
        $proposal = ChallengeProposal::create($this->proposal());

        $this->postJson("/api/challenges/proposals/{$proposal->id}/votes", ['uid' => 'arena-1'])
            ->assertCreated();
        $this->postJson("/api/challenges/proposals/{$proposal->id}/votes", ['uid' => 'arena-1'])
            ->assertConflict();
    }

    public function test_list_orders_featured_first_and_respects_limit(): void
    {
        $plain = ChallengeProposal::create($this->proposal('arena-plain'));
        $voted = ChallengeProposal::create($this->proposal('arena-voted'));
        $star = ChallengeProposal::create($this->proposal('arena-star'));
        ChallengeVote::create(['proposal_id' => $voted->id, 'uid' => 'v-1', 'weight' => 1.0]);
        ChallengeVote::create(['proposal_id' => $star->id, 'uid' => 'v-1', 'weight' => 6.0]);
        ChallengeVote::create(['proposal_id' => $star->id, 'uid' => 'v-2', 'weight' => 6.0]);

        $this->getJson('/api/challenges/proposals')
            ->assertOk()
            ->assertJsonPath('proposals.0.id', $star->id)
            ->assertJsonPath('proposals.0.featured', true)
            ->assertJsonPath('proposals.1.id', $voted->id)
            ->assertJsonPath('proposals.2.id', $plain->id);

        $this->getJson('/api/challenges/proposals?limit=2')
            ->assertOk()
            ->assertJsonCount(2, 'proposals')
            ->assertJsonPath('proposals.0.id', $star->id)
            ->assertJsonPath('proposals.1.id', $voted->id);
    }

    public function test_featured_flips_at_threshold(): void
    {
        // Thirteen ranked bots; voters 1-10 sit outside the top three.
        for ($i = 1; $i <= 13; $i++) {
            $this->postJson('/api/runs', $this->cityRun("arena-{$i}", (float) $i));
        }
        $proposal = ChallengeProposal::create($this->proposal());
        for ($i = 1; $i <= 10; $i++) {
            $this->postJson("/api/challenges/proposals/{$proposal->id}/votes", ['uid' => "arena-{$i}"])
                ->assertCreated();
        }

        // Ten base-weight votes clear the 10.0 featuring bar.
        $listed = $this->getJson('/api/challenges/proposals');
        $listed->assertOk()->assertJsonPath('proposals.0.featured', true);
        $this->assertEquals(10.0, $listed->json('proposals.0.weighted_votes'));
    }

    /** @return array<string, mixed> */
    private function validAssets(): array
    {
        return [
            'version' => 1,
            'palette' => ['moon' => 'moon', 'crater' => 'crater', 'accent' => 'brand', 'crane' => 'gold'],
            'scenery' => ['trees' => 12, 'clouds' => 4, 'beacons' => 6, 'pennants' => 10, 'shrooms' => 5],
            'moon' => ['craters' => 14, 'size' => 1.0],
            'towers' => ['heightScale' => 1.0],
        ];
    }

    /** @return array<string, mixed> */
    private function validAssetsV2(): array
    {
        return [
            'version' => 2,
            'palette' => ['moon' => 'moon', 'crater' => 'crater', 'accent' => 'brand', 'crane' => 'gold'],
            'scenery' => ['trees' => 12, 'clouds' => 4, 'beacons' => 6, 'pennants' => 10, 'shrooms' => 5, 'lanterns' => 3],
            'moon' => ['craters' => 14, 'size' => 1.0, 'halo' => 0.5],
            'towers' => ['heightScale' => 1.0, 'widthScale' => 1.2],
        ];
    }

    public function test_propose_carries_valid_assets(): void
    {
        $payload = $this->proposal();
        $payload['assets'] = $this->validAssets();

        $this->postJson('/api/challenges/proposals', $payload)
            ->assertCreated()
            ->assertJsonPath('assets.palette.crane', 'gold');

        $this->getJson('/api/challenges/proposals')
            ->assertOk()
            ->assertJsonPath('proposals.0.assets.moon.craters', 14);
    }

    public function test_propose_carries_v2_assets(): void
    {
        $payload = $this->proposal();
        $payload['assets'] = $this->validAssetsV2();

        $this->postJson('/api/challenges/proposals', $payload)
            ->assertCreated()
            ->assertJsonPath('assets.scenery.lanterns', 3)
            ->assertJsonPath('assets.moon.halo', 0.5)
            ->assertJsonPath('assets.towers.widthScale', 1.2);
    }

    public function test_propose_rejects_bad_assets(): void
    {
        $cases = [
            'gameplay smuggling' => ['gameplay' => ['shocks' => 9]],
            'wrong version' => ['version' => 3],
            'unknown swatch' => ['palette' => ['moon' => 'x', 'crater' => 'crater', 'accent' => 'brand', 'crane' => 'gold']],
            'oversized scenery' => ['scenery' => ['trees' => 99, 'clouds' => 0, 'beacons' => 0, 'pennants' => 0, 'shrooms' => 0]],
        ];
        foreach ($cases as $name => $override) {
            $payload = $this->proposal("arena-{$name}");
            $payload['assets'] = array_merge($this->validAssets(), $override);

            $this->postJson('/api/challenges/proposals', $payload)->assertUnprocessable();
        }
    }

    public function test_propose_rejects_cross_version_assets(): void
    {
        $payload = $this->proposal('arena-v1-lanterns');
        $assets = $this->validAssets();
        $scenery = $assets['scenery'];
        assert(is_array($scenery));
        $scenery['lanterns'] = 2;
        $assets['scenery'] = $scenery;
        $payload['assets'] = $assets;
        $this->postJson('/api/challenges/proposals', $payload)->assertUnprocessable();

        $payload = $this->proposal('arena-v2-slim');
        $assets = $this->validAssetsV2();
        $towers = $assets['towers'];
        assert(is_array($towers));
        unset($towers['widthScale']);
        $assets['towers'] = $towers;
        $payload['assets'] = $assets;
        $this->postJson('/api/challenges/proposals', $payload)->assertUnprocessable();
    }

    public function test_proposals_are_throttled_per_ip(): void
    {
        for ($i = 0; $i < 10; $i++) {
            $payload = $this->proposal("arena-{$i}");
            $payload['title'] = "Drill {$i}";
            $this->postJson('/api/challenges/proposals', $payload)->assertCreated();
        }

        $payload = $this->proposal('arena-overflow');
        $payload['title'] = 'Drill overflow';
        $this->postJson('/api/challenges/proposals', $payload)->assertStatus(429);
    }

    public function test_run_submits_do_not_eat_the_proposal_budget(): void
    {
        // Regression: unnamed limiters shared one IP counter across routes.
        for ($i = 0; $i < 9; $i++) {
            $this->postJson('/api/runs', $this->cityRun("arena-run-{$i}", (float) $i));
        }
        $first = $this->proposal('arena-first');
        $first['title'] = 'First drill';
        $this->postJson('/api/challenges/proposals', $first)->assertCreated();
        $second = $this->proposal('arena-second');
        $second['title'] = 'Second drill';
        $this->postJson('/api/challenges/proposals', $second)->assertCreated();
    }
}
