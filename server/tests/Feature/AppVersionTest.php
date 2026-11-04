<?php

namespace Tests\Feature;

use Tests\TestCase;

class AppVersionTest extends TestCase
{
    public function test_version_reports_configured_release(): void
    {
        config(['arena.app.version' => '0.2.0']);
        config(['arena.app.notes' => 'Lanterns and halos.']);

        $this->getJson('/api/app/version')
            ->assertOk()
            ->assertJsonPath('version', '0.2.0')
            ->assertJsonPath('url', 'https://simulate.damxstudio.com')
            ->assertJsonPath('notes', 'Lanterns and halos.');
    }

    public function test_version_defaults_when_unconfigured(): void
    {
        $this->getJson('/api/app/version')
            ->assertOk()
            ->assertJsonPath('version', '0.1.0');
    }

    public function test_downloads_default_to_the_stable_server_files(): void
    {
        config(['app.url' => 'https://board.example.com']);

        $this->getJson('/api/app/version')
            ->assertOk()
            ->assertJsonPath('downloads.mac', 'https://board.example.com/downloads/simulate-macos.dmg')
            ->assertJsonPath('downloads.windows', 'https://board.example.com/downloads/simulate-windows.exe')
            ->assertJsonPath('downloads.linux', 'https://board.example.com/downloads/simulate-linux.AppImage');
    }

    public function test_downloads_honor_per_platform_overrides(): void
    {
        config(['arena.app.downloads.mac' => 'https://cdn.example.com/s-mac.dmg']);
        config(['arena.app.downloads.windows' => '']);
        config(['app.url' => 'https://board.example.com']);

        $response = $this->getJson('/api/app/version')->assertOk();
        $response->assertJsonPath('downloads.mac', 'https://cdn.example.com/s-mac.dmg');
        // An empty override falls back to the stable server file.
        $response->assertJsonPath('downloads.windows', 'https://board.example.com/downloads/simulate-windows.exe');
    }
}
