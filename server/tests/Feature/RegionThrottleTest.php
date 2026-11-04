<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RegionThrottleTest extends TestCase
{
    use RefreshDatabase;

    /** @return array<string, mixed> */
    private function proposal(string $uid, string $title): array
    {
        return [
            'uid' => $uid,
            'nickname' => 'Rusty',
            'title' => $title,
            'description' => 'A heatwave knocks out clinics for three turns.',
            'model' => 'ollama/hermes3:8b',
            'input_prompt' => 'Keep the lights on with half the budget.',
            'output_format' => 'JSON allocations per turn',
        ];
    }

    /** @return array<string, mixed> */
    private function regionalPost(string $ip, string $uid, string $title): array
    {
        return $this->withServerVariables(['REMOTE_ADDR' => $ip])
            ->withHeaders(['CF-IPCountry' => 'DE'])
            ->postJson('/api/challenges/proposals', $this->proposal($uid, $title))
            ->json();
    }

    public function test_region_cap_counts_across_ips(): void
    {
        config([
            'arena.region.trusted_proxies' => ['10.0.0.0/8'],
            'arena.region.proposals_per_hour' => 2,
        ]);

        // Each IP is far under its own 10/h bucket; the shared DE cap binds.
        $this->assertSame(
            'Drill one',
            $this->regionalPost('10.0.0.1', 'arena-r1', 'Drill one')['title']
        );
        $this->assertSame(
            'Drill two',
            $this->regionalPost('10.0.0.2', 'arena-r2', 'Drill two')['title']
        );
        $this->withServerVariables(['REMOTE_ADDR' => '10.0.0.3'])
            ->withHeaders(['CF-IPCountry' => 'DE'])
            ->postJson('/api/challenges/proposals', $this->proposal('arena-r3', 'Drill three'))
            ->assertStatus(429);
    }

    public function test_unknown_region_stays_ip_only(): void
    {
        // A region cap of 1 must not bind when no feed resolves a region.
        config(['arena.region.proposals_per_hour' => 1]);

        $this->postJson('/api/challenges/proposals', $this->proposal('arena-u1', 'Drill u1'))
            ->assertCreated();
        $this->postJson('/api/challenges/proposals', $this->proposal('arena-u2', 'Drill u2'))
            ->assertCreated();
    }

    public function test_cf_header_ignored_from_untrusted_remote(): void
    {
        config([
            'arena.region.trusted_proxies' => ['10.0.0.0/8'],
            'arena.region.proposals_per_hour' => 1,
        ]);

        // Test remotes are 127.0.0.1: the spoofable header must not count.
        $this->withHeaders(['CF-IPCountry' => 'DE'])
            ->postJson('/api/challenges/proposals', $this->proposal('arena-s1', 'Drill s1'))
            ->assertCreated();
        $this->withHeaders(['CF-IPCountry' => 'DE'])
            ->postJson('/api/challenges/proposals', $this->proposal('arena-s2', 'Drill s2'))
            ->assertCreated();
    }
}
