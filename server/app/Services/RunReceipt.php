<?php

namespace App\Services;

/**
 * Sim-signed run receipts: the board trusts sim-witnessed scores only.
 *
 * When SIM_RECEIPT_SECRET is configured, run submissions must carry
 * the receipt the sim attached to the result ({payload, sig} over
 * canonical JSON), and votes must present any receipt bound to the
 * voter uid. Fabrication then requires the shared secret, not just
 * the submitter's arena id. With the secret unset (local play),
 * writes stay open exactly as before.
 */
class RunReceipt
{
    public const RATED_CITY_TURNS = 12;

    public static function requiresReceipt(): bool
    {
        return (string) config('services.sim.receipt_secret', '') !== '';
    }

    /**
     * Verify a receipt's HMAC over its verbatim payload string.
     *
     * @param  array<string, mixed>|null  $receipt
     * @return array<string, mixed>|null  Decoded payload, or null on any failure.
     */
    public static function verify(?array $receipt): ?array
    {
        $secret = (string) config('services.sim.receipt_secret', '');
        if ($secret === '' || ! is_array($receipt)) {
            return null;
        }
        $payload = $receipt['payload'] ?? null;
        $sig = $receipt['sig'] ?? null;
        if (! is_string($payload) || ! is_string($sig) || $payload === '') {
            return null;
        }
        $expected = hash_hmac('sha256', $payload, $secret);
        if (! hash_equals($expected, strtolower($sig))) {
            return null;
        }
        $decoded = json_decode($payload, true);
        if (! is_array($decoded)) {
            return null;
        }

        /** @var array<string, mixed> $decoded */
        return $decoded;
    }

    /**
     * Check a decoded payload against submitted run fields. Every
     * board-visible field must match; city runs must also be full
     * rated seasons, since short-season scores are not comparable.
     *
     * @param  array<string, mixed>  $payload
     * @param  array<string, mixed>  $fields
     */
    public static function matchesRun(array $payload, array $fields): bool
    {
        if (($payload['game'] ?? null) !== ($fields['game'] ?? null)) {
            return false;
        }
        if (($payload['uid'] ?? null) !== ($fields['uid'] ?? null)) {
            return false;
        }
        if (($payload['challenge'] ?? null) !== ($fields['challenge'] ?? null)) {
            return false;
        }
        if ((int) ($payload['seed'] ?? -1) !== (int) ($fields['seed'] ?? -2)) {
            return false;
        }
        if (($payload['model'] ?? null) !== ($fields['model'] ?? null)) {
            return false;
        }
        if (($payload['provider'] ?? null) !== ($fields['provider'] ?? null)) {
            return false;
        }
        if (! self::sameBadges($payload['badges'] ?? null, $fields['badges'] ?? null)) {
            return false;
        }
        if (($fields['game'] ?? null) === 'city') {
            if ((int) ($payload['turns'] ?? -1) !== self::RATED_CITY_TURNS) {
                return false;
            }
            return self::sameFloat($payload['impact'] ?? null, $fields['impact'] ?? null)
                && self::sameFloat($payload['efficiency'] ?? null, $fields['efficiency'] ?? null);
        }

        return self::sameFloat($payload['score'] ?? null, $fields['score'] ?? null);
    }

    /** @param  mixed  $left @param  mixed  $right */
    private static function sameFloat(mixed $left, mixed $right): bool
    {
        if (! is_numeric($left) || ! is_numeric($right)) {
            return false;
        }

        return abs((float) $left - (float) $right) < 1e-9;
    }

    /** @param  mixed  $left @param  mixed  $right */
    private static function sameBadges(mixed $left, mixed $right): bool
    {
        $leftList = is_array($left) ? array_values($left) : [];
        $rightList = is_array($right) ? array_values($right) : [];
        sort($leftList);
        sort($rightList);

        return $leftList === $rightList;
    }
}
