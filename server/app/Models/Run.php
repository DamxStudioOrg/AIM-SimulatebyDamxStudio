<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Run extends Model
{
    /** Metrics that can rank a leaderboard. */
    public const CITY_METRICS = ['impact', 'efficiency'];

    public const TOTE_METRICS = ['score'];

    /** @var list<string> */
    protected $fillable = [
        'uid',
        'game',
        'challenge',
        'seed',
        'model',
        'provider',
        'nickname',
        'badges',
        'strategy',
        'impact',
        'efficiency',
        'score',
        'details',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'seed' => 'integer',
            'impact' => 'float',
            'efficiency' => 'float',
            'score' => 'float',
            'details' => 'array',
            'badges' => 'array',
            'strategy' => 'array',
        ];
    }

    /** Metrics allowed for a game, or null for an unknown game. */
    public static function metricsFor(string $game): ?array
    {
        return match ($game) {
            'city' => self::CITY_METRICS,
            'tote' => self::TOTE_METRICS,
            default => null,
        };
    }
}
