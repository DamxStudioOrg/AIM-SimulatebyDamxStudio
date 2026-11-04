<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;

class AppVersionController extends Controller
{
    /**
     * Stable installer filenames under public/downloads/. Releases
     * overwrite these files and bump APP_VERSION; the mac build is
     * universal (Apple Silicon + Intel) so one button serves both.
     */
    private const DOWNLOAD_FILES = [
        'mac' => 'simulate-macos.dmg',
        'windows' => 'simulate-windows.exe',
        'linux' => 'simulate-linux.AppImage',
    ];

    /**
     * Shipped desktop version, plus per-platform installer links.
     * Public and unthrottled: the app checks weekly, the landing
     * buttons read the downloads map, and both cost nothing to serve.
     */
    public function show(): JsonResponse
    {
        return response()->json([
            'version' => (string) config('arena.app.version', '0.1.0'),
            'url' => (string) config('arena.app.url', 'https://simulate.damxstudio.com'),
            'notes' => (string) config('arena.app.notes', ''),
            'downloads' => $this->downloads(),
        ]);
    }

    /** @return array<string, string> */
    private function downloads(): array
    {
        $base = rtrim((string) config('app.url', 'http://localhost:8000'), '/');
        $out = [];
        foreach (self::DOWNLOAD_FILES as $platform => $file) {
            $configured = config("arena.app.downloads.{$platform}");
            $out[$platform] = is_string($configured) && $configured !== ''
                ? $configured
                : "{$base}/downloads/{$file}";
        }

        return $out;
    }
}
