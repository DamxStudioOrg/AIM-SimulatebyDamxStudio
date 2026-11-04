<?php

namespace App\Services;

use GeoIp2\Database\Reader;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\IpUtils;

class RegionResolver
{
    /**
     * ISO-3166 two-letter country for a request, or null when the region
     * is unknown. Cloudflare's edge header first (trusted proxies only),
     * then the operator's MaxMind database. Never throws: resolution is
     * best-effort enrichment and must not break the request it guards.
     */
    public static function for(Request $request): ?string
    {
        $header = (string) config('arena.region.cf_header', 'CF-IPCountry');

        return self::cloudflareCountry(
            $header === '' ? null : $request->headers->get($header),
            (string) $request->server('REMOTE_ADDR', ''),
            (array) config('arena.region.trusted_proxies', [])
        ) ?? self::maxmindCountry(
            $request->ip(),
            config('arena.region.maxmind_db')
        );
    }

    public static function cloudflareCountry(
        ?string $headerValue,
        string $remoteAddr,
        array $trustedProxies
    ): ?string {
        if ($headerValue === null || $remoteAddr === '') {
            return null;
        }
        $trusted = false;
        foreach ($trustedProxies as $proxy) {
            if (is_string($proxy) && $proxy !== '' && IpUtils::checkIp($remoteAddr, $proxy)) {
                $trusted = true;
                break;
            }
        }
        if (! $trusted) {
            return null;
        }
        $code = strtoupper(trim($headerValue));

        return preg_match('/^[A-Z]{2}$/', $code) === 1 ? $code : null;
    }

    public static function maxmindCountry(?string $ip, mixed $dbPath): ?string
    {
        if ($ip === null || $ip === '') {
            return null;
        }
        if (! is_string($dbPath) || $dbPath === '' || ! is_readable($dbPath)) {
            return null;
        }
        try {
            $reader = new Reader($dbPath);
            $code = $reader->country($ip)->country->isoCode;
            $reader->close();
        } catch (\Exception) {
            // Best effort: a corrupt, stale, or private-IP lookup resolves
            // to unknown, and the per-IP buckets still stand guard.
            return null;
        }

        return is_string($code) && preg_match('/^[A-Z]{2}$/', $code) === 1 ? $code : null;
    }
}
