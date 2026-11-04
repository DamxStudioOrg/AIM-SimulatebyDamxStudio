<?php

namespace Tests\Unit;

use App\Services\RegionResolver;
use PHPUnit\Framework\TestCase;

class RegionResolverTest extends TestCase
{
    public function test_cloudflare_country_needs_a_trusted_remote(): void
    {
        $this->assertSame(
            'DE',
            RegionResolver::cloudflareCountry('DE', '10.0.0.9', ['10.0.0.0/8'])
        );
        $this->assertNull(
            RegionResolver::cloudflareCountry('DE', '192.0.2.9', ['10.0.0.0/8'])
        );
        $this->assertNull(RegionResolver::cloudflareCountry('DE', '10.0.0.9', []));
    }

    public function test_cloudflare_country_rejects_malformed_values(): void
    {
        foreach (['Germany', 'D E', 'D1', 'ABC', '', '   '] as $value) {
            $this->assertNull(
                RegionResolver::cloudflareCountry($value, '10.0.0.9', ['10.0.0.0/8']),
                "value {$value} must not resolve"
            );
        }
        $this->assertNull(
            RegionResolver::cloudflareCountry(null, '10.0.0.9', ['10.0.0.0/8'])
        );
    }

    public function test_cloudflare_country_normalizes_case_and_space(): void
    {
        $this->assertSame(
            'DE',
            RegionResolver::cloudflareCountry(' de ', '10.0.0.9', ['10.0.0.9'])
        );
    }

    public function test_maxmind_country_needs_a_readable_database(): void
    {
        $this->assertNull(RegionResolver::maxmindCountry('8.8.8.8', null));
        $this->assertNull(RegionResolver::maxmindCountry('8.8.8.8', ''));
        $this->assertNull(
            RegionResolver::maxmindCountry('8.8.8.8', '/missing/GeoLite2-Country.mmdb')
        );
        $this->assertNull(RegionResolver::maxmindCountry(null, '/missing/x.mmdb'));
        $this->assertNull(RegionResolver::maxmindCountry('', '/missing/x.mmdb'));
    }

    public function test_maxmind_country_survives_a_corrupt_database(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'geo');
        $this->assertNotFalse($path);
        file_put_contents($path, 'not a maxmind database');
        try {
            $this->assertNull(RegionResolver::maxmindCountry('8.8.8.8', $path));
        } finally {
            unlink($path);
        }
    }
}
