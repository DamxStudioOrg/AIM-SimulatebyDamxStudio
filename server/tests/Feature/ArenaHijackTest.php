<?php

namespace Tests\Feature;

use App\Models\ChallengeProposal;
use App\Models\ChallengeVote;
use App\Models\Run;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Blue/red-team containment for free arena IDs.
 *
 * Identity in this system is possession of the ID: runs are
 * append-only, votes are unique per (proposal, uid), and vote
 * weight is earned by recorded runs. These tests attack those three
 * guarantees the way a hijacker would — forging as a victim,
 * flooding fresh IDs, double-voting, stuffing metrics — and pin
 * what the server must refuse or contain. Where a behaviour is
 * by-design (an in-range forged run posts in open mode, because the
 * board cannot tell devices apart), the test pins the containment
 * instead: the victim's recorded rows are never mutated. Impossible
 * metrics never post at all.
 */
class ArenaHijackTest extends TestCase
{
    use RefreshDatabase;

    /** @return array<string, mixed> */
    private function cityRun(string $uid, float $impact = 3.0): array
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

    public function test_forged_run_cannot_mutate_or_delete_victim_rows(): void
    {
        $this->postJson('/api/runs', $this->cityRun('victim', 5.0))->assertCreated();
        $before = Run::where('uid', 'victim')->firstOrFail();

        // Attacker posts AS the victim with an in-range metric: open
        // mode cannot tell devices apart, so it appends — but the
        // original row is untouched, and no endpoint lets anyone edit
        // or delete rows (404, not a forbidden-but-present endpoint).
        $this->postJson('/api/runs', $this->cityRun('victim', 7.0))->assertCreated();
        $this->assertSame(2, Run::where('uid', 'victim')->count());
        $this->assertEquals(5.0, Run::findOrFail($before->id)->impact);
        $this->putJson('/api/runs/'.$before->id, $this->cityRun('victim', 0.0))
            ->assertNotFound();
        $this->deleteJson('/api/runs/'.$before->id)->assertNotFound();
    }

    public function test_impossible_metrics_never_post(): void
    {
        // City metrics are 0-100 by construction; tote scores bottom
        // out at 0. Anything outside never reaches the board.
        $this->postJson('/api/runs', $this->cityRun('victim', 999.0))
            ->assertUnprocessable();
        $bad = $this->cityRun('victim', 5.0);
        $bad['efficiency'] = -1.0;
        $this->postJson('/api/runs', $bad)->assertUnprocessable();
        $this->assertSame(0, Run::where('uid', 'victim')->count());
    }

    public function test_fresh_id_cannot_vote_until_it_has_played(): void
    {
        $proposal = ChallengeProposal::create([
            'uid' => 'author',
            'title' => 'Hijack target',
            'description' => 'A trial worth hijacking.',
            'model' => 'test-model',
            'input_prompt' => 'Prompt.',
            'output_format' => 'JSON',
        ]);

        // A brand-new ID with no recorded runs carries zero weight.
        $this->postJson("/api/challenges/proposals/{$proposal->id}/votes", [
            'uid' => 'fresh-attacker',
        ])->assertUnprocessable();
        $this->assertSame(0, ChallengeVote::count());

        // The same ID becomes a voter only after a recorded run.
        $this->postJson('/api/runs', $this->cityRun('fresh-attacker'))->assertCreated();
        $this->postJson("/api/challenges/proposals/{$proposal->id}/votes", [
            'uid' => 'fresh-attacker',
        ])->assertCreated();
    }

    public function test_one_vote_per_id_even_for_the_proposal_author(): void
    {
        $proposal = ChallengeProposal::create([
            'uid' => 'author',
            'title' => 'Self-dealing target',
            'description' => 'Author tries to stuff the ballot.',
            'model' => 'test-model',
            'input_prompt' => 'Prompt.',
            'output_format' => 'JSON',
        ]);
        $this->postJson('/api/runs', $this->cityRun('author'))->assertCreated();

        $vote = "/api/challenges/proposals/{$proposal->id}/votes";
        $this->postJson($vote, ['uid' => 'author'])->assertCreated();
        $this->postJson($vote, ['uid' => 'author'])->assertStatus(409);
        $this->assertSame(1, ChallengeVote::where('proposal_id', $proposal->id)->count());
    }

    public function test_metric_stuffing_and_oversized_blobs_are_rejected(): void
    {
        // Metrics must be numeric: string scores never reach the board.
        $bad = $this->cityRun('stuffer');
        $bad['impact'] = 'not-a-number';
        $this->postJson('/api/runs', $bad)->assertUnprocessable();
        $this->assertSame(0, Run::count());

        // Oversized strategy blobs are capped before they bloat rows.
        $wide = $this->cityRun('stuffer');
        $wide['strategy'] = ['blob' => str_repeat('x', 9000)];
        $this->postJson('/api/runs', $wide)->assertUnprocessable();
        $this->assertSame(0, Run::count());
    }

    public function test_unknown_uid_gets_no_you_row_on_the_board(): void
    {
        $this->postJson('/api/runs', $this->cityRun('someone'))->assertCreated();

        $response = $this->getJson('/api/leaderboard?game=city&metric=impact&uid=ghost');
        $response->assertOk();
        $this->assertNull($response->json('you'));
    }

    public function test_script_like_nickname_is_stored_verbatim_not_executed(): void
    {
        // Nicknames are data; rendering escapes them. The server must
        // store the string without mutating or rejecting it as code.
        $payload = $this->cityRun('victim');
        $payload['nickname'] = '<script>alert(1)</script>';
        $this->postJson('/api/runs', $payload)->assertCreated();
        $this->assertDatabaseHas('runs', [
            'uid' => 'victim',
            'nickname' => '<script>alert(1)</script>',
        ]);
    }
}
