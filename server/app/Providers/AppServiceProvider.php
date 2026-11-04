<?php

namespace App\Providers;

use App\Services\RegionResolver;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Named per-IP buckets: ids are free by design, so flood protection
        // lives on the write endpoints. Unnamed limiters would share one
        // counter across every route — these must stay separate. Each
        // bucket also carries a loose per-region backstop cap when the
        // request's country resolves; unknown regions stay IP-only.
        RateLimiter::for('runs', fn (Request $request) => $this->limitsFor('runs', $request));
        RateLimiter::for('proposals', fn (Request $request) => $this->limitsFor('proposals', $request));
        RateLimiter::for('votes', fn (Request $request) => $this->limitsFor('votes', $request));
    }

    /** @return list<Limit> */
    private function limitsFor(string $bucket, Request $request): array
    {
        $limits = [
            Limit::perHour((int) config("arena.throttle.{$bucket}_per_hour"))
                ->by($request->ip()),
        ];
        $region = RegionResolver::for($request);
        if ($region !== null) {
            $limits[] = Limit::perHour((int) config("arena.region.{$bucket}_per_hour"))
                ->by("region:{$bucket}:{$region}");
        }

        return $limits;
    }
}
