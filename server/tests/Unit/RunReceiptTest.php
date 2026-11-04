<?php

namespace Tests\Unit;

use App\Services\RunReceipt;
use Tests\TestCase;

/**
 * Sim-signed receipt verification: HMAC over the verbatim payload,
 * then field-by-field match against the submitted row.
 */
class RunReceiptTest extends TestCase
{
    /** @return array<string, mixed> */
    private function payload(): array
    {
        return [
            'badges' => ['b1', 'b2'],
            'challenge' => 'debut',
            'efficiency' => 8.25,
            'game' => 'city',
            'impact' => 62.0,
            'model' => 'meta/Llama-4-Scout',
            'provider' => 'meta:Llama-4-Scout',
            'seed' => 3,
            'turns' => 12,
            'uid' => 'rider-7',
        ];
    }

    /** @param  array<string, mixed>  $payload */
    private function sign(array $payload, string $secret = 's3cret'): array
    {
        // Canonical form mirrors the sim signer exactly: sorted keys,
        // tight separators, slashes unescaped, whole floats kept whole.
        ksort($payload);

        $canonical = (string) json_encode(
            $payload,
            JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION
        );

        return ['payload' => $canonical, 'sig' => hash_hmac('sha256', $canonical, $secret)];
    }

    public function test_golden_vector_from_the_python_signer_verifies(): void
    {
        config(['services.sim.receipt_secret' => 'golden-secret-1']);
        // Minted by aim_sim.receipts.sign_payload; pins cross-language
        // interop (note the unescaped slash in the model id).
        $receipt = [
            'payload' => '{"badges":["b1","b2"],"challenge":"debut","efficiency":8.25,"game":"city","impact":62.0,"model":"meta/Llama-4-Scout","provider":"meta:Llama-4-Scout","seed":3,"turns":12,"uid":"rider-7"}',
            'sig' => '6201a5171b5cbda018fa042478daee5c073282cd23ca5de5364d2479ebd23027',
        ];

        $decoded = RunReceipt::verify($receipt);

        $this->assertSame('rider-7', $decoded['uid'] ?? null);
        $this->assertSame(62.0, $decoded['impact'] ?? null);
    }

    public function test_verification_fails_closed(): void
    {
        config(['services.sim.receipt_secret' => 's3cret']);
        $good = $this->sign($this->payload());

        $this->assertNotNull(RunReceipt::verify($good));
        $this->assertNull(RunReceipt::verify(null));
        $this->assertNull(RunReceipt::verify(['payload' => 'x']));
        $this->assertNull(RunReceipt::verify(['payload' => 'x', 'sig' => 'nope']));
        $this->assertNull(RunReceipt::verify([
            'payload' => '{"game": oops}',
            'sig' => str_repeat('0', 64),
        ]));

        // Tampered payload under the original signature.
        $tampered = $good;
        $tampered['payload'] = str_replace('62.0', '99.9', $good['payload']);
        $this->assertNull(RunReceipt::verify($tampered));

        // Wrong secret.
        config(['services.sim.receipt_secret' => 'other']);
        $this->assertNull(RunReceipt::verify($good));

        // Unset secret verifies nothing (open local mode).
        config(['services.sim.receipt_secret' => '']);
        $this->assertNull(RunReceipt::verify($good));
        $this->assertFalse(RunReceipt::requiresReceipt());
    }

    public function test_run_match_compares_every_board_field(): void
    {
        $payload = $this->payload();
        $fields = [
            'game' => 'city', 'uid' => 'rider-7', 'challenge' => 'debut',
            'seed' => 3, 'model' => 'meta/Llama-4-Scout', 'provider' => 'meta:Llama-4-Scout',
            'impact' => 62.0, 'efficiency' => 8.25, 'badges' => ['b2', 'b1'],
        ];

        $this->assertTrue(RunReceipt::matchesRun($payload, $fields));

        foreach (['game' => 'tote', 'uid' => 'mallory', 'challenge' => 'rush',
            'seed' => 4, 'model' => 'other', 'provider' => 'other',
            'impact' => 62.1, 'efficiency' => 0.0] as $key => $evil) {
            $forged = $fields;
            $forged[$key] = $evil;
            $this->assertFalse(RunReceipt::matchesRun($payload, $forged), "field {$key}");
        }

        $badBadges = $fields;
        $badBadges['badges'] = ['b1', 'forged'];
        $this->assertFalse(RunReceipt::matchesRun($payload, $badBadges));

        // Short seasons are bound but not rated-length.
        $short = $payload;
        $short['turns'] = 4;
        $this->assertFalse(RunReceipt::matchesRun($short, $fields));
    }

    public function test_tote_match_compares_score(): void
    {
        $payload = [
            'game' => 'tote', 'uid' => 'rider-7', 'challenge' => null,
            'seed' => 4, 'model' => 'local/x', 'provider' => 'stub',
            'score' => 88.0, 'badges' => [],
        ];
        $fields = $payload;

        $this->assertTrue(RunReceipt::matchesRun($payload, $fields));
        $fields['score'] = 99.0;
        $this->assertFalse(RunReceipt::matchesRun($payload, $fields));
    }
}
