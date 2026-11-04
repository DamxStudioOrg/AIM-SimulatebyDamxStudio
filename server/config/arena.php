<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Ranking knobs
    |--------------------------------------------------------------------------
    | Placeholder weights for vote influence and board adjustments. Values
    | below match the shipped constants; tune on real data via env.
    */
    'ranking' => [
        'vote_base' => (float) env('ARENA_VOTE_BASE', 1.0),
        'vote_badge_each' => (float) env('ARENA_VOTE_BADGE_EACH', 0.25),
        'vote_badge_max' => (float) env('ARENA_VOTE_BADGE_MAX', 1.0),
        'vote_rank_bonus' => (float) env('ARENA_VOTE_RANK_BONUS', 1.0),
        'vote_rank_depth' => (int) env('ARENA_VOTE_RANK_DEPTH', 3),
        'diversity_min_population' => (int) env('ARENA_DIVERSITY_MIN_POPULATION', 5),
        'diversity_radius' => (float) env('ARENA_DIVERSITY_RADIUS', 10.0),
        'diversity_cluster_min' => (int) env('ARENA_DIVERSITY_CLUSTER_MIN', 3),
        'diversity_penalty' => (float) env('ARENA_DIVERSITY_PENALTY', 0.5),
        'badge_boost_each' => (float) env('ARENA_BADGE_BOOST_EACH', 0.25),
        'badge_boost_max' => (float) env('ARENA_BADGE_BOOST_MAX', 1.0),
        'adjustment_pool_max' => (int) env('ARENA_ADJUSTMENT_POOL_MAX', 500),
    ],

    /*
    |--------------------------------------------------------------------------
    | Per-IP write buckets (attempts per hour)
    |--------------------------------------------------------------------------
    | Ids are free by design, so flood protection lives on the writes.
    */
    'throttle' => [
        'runs_per_hour' => (int) env('ARENA_THROTTLE_RUNS', 120),
        'proposals_per_hour' => (int) env('ARENA_THROTTLE_PROPOSALS', 10),
        'votes_per_hour' => (int) env('ARENA_THROTTLE_VOTES', 60),
    ],

    /*
    |--------------------------------------------------------------------------
    | Region backstop caps (attempts per hour per country)
    |--------------------------------------------------------------------------
    | A second, much looser bucket that only binds distributed farming
    | from many IPs in one region. Resolution order: Cloudflare's edge
    | header (trusted proxies only — the header is spoofable otherwise),
    | then a local MaxMind GeoLite2 database when the operator installs
    | one (composer already vendors geoip2/geoip2; point
    | ARENA_MAXMIND_DB at the .mmdb file). Unknown region means the
    | per-IP buckets stand alone — never a block, never a guess.
    */
    'region' => [
        'cf_header' => env('ARENA_REGION_CF_HEADER', 'CF-IPCountry'),
        'trusted_proxies' => array_values(array_filter(array_map(
            trim(...),
            explode(',', (string) env('ARENA_TRUSTED_PROXIES', ''))
        ))),
        'maxmind_db' => env('ARENA_MAXMIND_DB'),
        'runs_per_hour' => (int) env('ARENA_REGION_RUNS', 5000),
        'proposals_per_hour' => (int) env('ARENA_REGION_PROPOSALS', 500),
        'votes_per_hour' => (int) env('ARENA_REGION_VOTES', 2000),
    ],

    /*
    |--------------------------------------------------------------------------
    | Shipped app version
    |--------------------------------------------------------------------------
    | The desktop app checks this once a week (plus a manual button in
    | Account) and offers the download page when it runs older. Bump
    | APP_VERSION with each release; the notes ride the update card.
    */
    'app' => [
        'version' => env('APP_VERSION', '0.1.0'),
        'url' => env('APP_DOWNLOAD_URL', 'https://simulate.damxstudio.com'),
        'notes' => env('APP_VERSION_NOTES', ''),
        /*
        | Per-platform installers. Each release overwrites the stable
        | filenames under public/downloads/ and bumps APP_VERSION; the
        | landing buttons and the in-app update card read this map from
        | GET /api/app/version, so uploads never need a code change.
        | Null entries fall back to <APP_URL>/downloads/<stable file>.
        */
        'downloads' => [
            'mac' => env('APP_DOWNLOAD_MAC'),
            'windows' => env('APP_DOWNLOAD_WINDOWS'),
            'linux' => env('APP_DOWNLOAD_LINUX'),
        ],
    ],

];
