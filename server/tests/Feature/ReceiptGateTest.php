<?php

namespace Tests\Feature;

use App\Models\ChallengeProposal;
use App\Models\ChallengeVote;
use App\Models\Run;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Receipt gates: with the board secret configured, run submissions
 * must carry the sim's signature over their scored fields, and
 * votes must present a receipt bound to the voter uid. Without the
 * secret, local play stays open exactly as before.
 */
class ReceiptGateTest extends TestCase
{
    use RefreshDatabase;

    /** @param  array<string, mixed>  $payload */
    private function sign(array $payload): array
    {
        // Same canonical form the sim signer emits: sorted keys, tight
        // separators, slashes unescaped, whole floats kept whole.
        ksort($payload);
        $canonical = (string) json_encode(
            $payload,
            JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION
        );

        return ['payload' => $canonical, 'sig' => hash_hmac('sha256', $canonical, 's3cret')];
    }

    /** @return array<string, mixed> */
    private function cityRun(string $uid): array
    {
        return [
            'uid' => $uid,
            'game' => 'city',
            'challenge' => 'debut',
            'seed' => 3,
            'model' => 'local/test-model',
            'provider' => 'stub',
            'impact' => 62.0,
            'efficiency' => 8.0,
            'badges' => ['b1'],
        ];
    }

    /** @return array<string, mixed> */
    private function cityPayload(string $uid): array
    {
        return [
            'game' => 'city',
            'uid' => $uid,
            'challenge' => 'debut',
            'seed' => 3,
            'model' => 'local/test-model',
            'provider' => 'stub',
            'turns' => 12,
            'impact' => 62.0,
            'efficiency' => 8.0,
            'badges' => ['b1'],
        ];
    }

    public function test_verified_run_is_accepted(): void
    {
        config(['services.sim.receipt_secret' => 's3cret']);
        $run = $this->cityRun('rider-7');
        $run['receipt'] = $this->sign($this->cityPayload('rider-7'));

        $this->postJson('/api/runs', $run)->assertCreated();
        $this->assertSame(1, Run::where('uid', 'rider-7')->count());
    }

    public function test_missing_or_tampered_receipt_is_rejected(): void
    {
        config(['services.sim.receipt_secret' => 's3cret']);

        $this->postJson('/api/runs', $this->cityRun('rider-7'))
            ->assertStatus(422)->assertJson(['error' => 'unverified_run']);

        // Right signature, wrong score.
        $forged = $this->cityRun('rider-7');
        $forged['impact'] = 99.0;
        $forged['receipt'] = $this->sign($this->cityPayload('rider-7'));
        $this->postJson('/api/runs', $forged)
            ->assertStatus(422)->assertJson(['error' => 'unverified_run']);

        // Right payload shape, wrong secret.
        $badSig = $this->cityRun('rider-7');
        $receipt = $this->sign($this->cityPayload('rider-7'));
        $receipt['sig'] = str_repeat('0', 64);
        $badSig['receipt'] = $receipt;
        $this->postJson('/api/runs', $badSig)
            ->assertStatus(422)->assertJson(['error' => 'unverified_run']);

        $this->assertSame(0, Run::count());
    }

    public function test_short_season_scores_are_rejected(): void
    {
        config(['services.sim.receipt_secret' => 's3cret']);
        $payload = $this->cityPayload('rider-7');
        $payload['turns'] = 4;
        $run = $this->cityRun('rider-7');
        $run['receipt'] = $this->sign($payload);

        $this->postJson('/api/runs', $run)
            ->assertStatus(422)->assertJson(['error' => 'unverified_run']);
        $this->assertSame(0, Run::count());
    }

    public function test_vote_requires_a_receipt_for_the_voter(): void
    {
        config(['services.sim.receipt_secret' => 's3cret']);
        $proposal = ChallengeProposal::create([
            'uid' => 'author',
            'title' => 'Gated target',
            'description' => 'Votes need receipts.',
            'model' => 'test-model',
            'input_prompt' => 'Prompt.',
            'output_format' => 'JSON',
        ]);
        $url = "/api/challenges/proposals/{$proposal->id}/votes";

        // No receipt at all.
        $this->postJson($url, ['uid' => 'rider-7'])
            ->assertStatus(422)->assertJson(['error' => 'unverified_voter']);

        // Receipt bound to someone else.
        $this->postJson($url, [
            'uid' => 'rider-7',
            'receipt' => $this->sign($this->cityPayload('mallory')),
        ])->assertStatus(422)->assertJson(['error' => 'unverified_voter']);
        $this->assertSame(0, ChallengeVote::count());

        // The voter's own receipt, plus a recorded run for standing.
        $run = $this->cityRun('rider-7');
        $run['receipt'] = $this->sign($this->cityPayload('rider-7'));
        $this->postJson('/api/runs', $run)->assertCreated();
        $this->postJson($url, [
            'uid' => 'rider-7',
            'receipt' => $this->sign($this->cityPayload('rider-7')),
        ])->assertCreated();
        $this->assertSame(1, ChallengeVote::count());
    }

    public function test_open_mode_accepts_unsigned_writes(): void
    {
        config(['services.sim.receipt_secret' => '']);

        $this->postJson('/api/runs', $this->cityRun('rider-7'))->assertCreated();
        $proposal = ChallengeProposal::create([
            'uid' => 'author',
            'title' => 'Open target',
            'description' => 'No secret configured.',
            'model' => 'test-model',
            'input_prompt' => 'Prompt.',
            'output_format' => 'JSON',
        ]);
        $this->postJson(
            "/api/challenges/proposals/{$proposal->id}/votes",
            ['uid' => 'rider-7']
        )->assertCreated();
    }
}
