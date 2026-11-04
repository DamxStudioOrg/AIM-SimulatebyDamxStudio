<?php

namespace App\Http\Controllers;

use App\Models\ChallengeProposal;
use App\Models\ChallengeVote;
use App\Rules\NoControlChars;
use App\Services\RunReceipt;
use App\Services\VoteWeight;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProposalController extends Controller
{
    // Placeholder bar: proposals at or above this weighted total read as
    // featured. Tune once real voting lands.
    public const FEATURED_WEIGHTED_VOTES = 10.0;

    public const DEFAULT_LIMIT = 20;

    public const MAX_LIMIT = 50;

    // Asset schema v1: visual-only stage dressing. Keep in sync with
    // sim/src/aim_sim/assets.py and web/lib/stage3d.ts SWATCH_IDS.
    public const ASSET_SWATCHES = [
        'sky', 'ground', 'street', 'far', 'mid', 'water', 'heat', 'leader',
        'brand', 'ink', 'moon', 'crater', 'coral', 'mint', 'gold', 'grape',
    ];

    public const ASSET_MAX_BYTES = 4096;

    /**
     * Propose a community challenge: the model to beat, an input prompt,
     * the desired output shape, and any restrictions.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'uid' => 'required|string|max:128',
            'nickname' => ['nullable', 'string', 'max:32', new NoControlChars],
            'title' => ['required', 'string', 'max:80', new NoControlChars],
            'description' => ['required', 'string', 'max:2000', new NoControlChars],
            'model' => ['required', 'string', 'max:64', new NoControlChars],
            'input_prompt' => ['required', 'string', 'max:2000', new NoControlChars],
            'output_format' => ['required', 'string', 'max:255', new NoControlChars],
            'restrictions' => ['nullable', 'string', 'max:2000', new NoControlChars],
            'assets' => ['nullable', 'array', function (string $attribute, mixed $value, Closure $fail): void {
                self::checkAssets($value, $fail);
            }],
        ]);

        $proposal = ChallengeProposal::create($validated);

        return response()->json($this->rowFor($proposal), 201);
    }

    /** Proposals with vote totals, featured first, then heaviest. */
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'limit' => 'nullable|integer|min:1|max:'.self::MAX_LIMIT,
        ]);
        $limit = $validated['limit'] ?? self::DEFAULT_LIMIT;

        // Ordered and capped in SQL: featured is exactly weighted >= 10
        // with non-negative weights, so weighted-descending already puts
        // featured rows first without fetching the whole table.
        $proposals = ChallengeProposal::withSum('votes as weighted_votes', 'weight')
            ->withCount('votes')
            ->orderByDesc('weighted_votes')
            ->orderBy('created_at')
            ->limit($limit)
            ->get()
            ->map(fn (ChallengeProposal $proposal) => $this->rowFor($proposal))
            ->values();

        return response()->json(['proposals' => $proposals]);
    }

    /**
     * Cast one rank-weighted vote. Unranked ids cannot vote, and each id
     * votes once per proposal. When the board secret is configured, the
     * voter also presents a sim-signed receipt bound to their uid —
     * possession of the id alone no longer suffices.
     */
    public function vote(Request $request, ChallengeProposal $proposal): JsonResponse
    {
        $validated = $request->validate([
            'uid' => 'required|string|max:128',
            'receipt' => 'nullable|array',
            'receipt.payload' => 'required_with:receipt|string|max:8192',
            'receipt.sig' => 'required_with:receipt|string|max:128',
        ]);
        $uid = $validated['uid'];

        if (RunReceipt::requiresReceipt()) {
            $payload = RunReceipt::verify($validated['receipt'] ?? null);
            if ($payload === null || ($payload['uid'] ?? null) !== $uid) {
                return response()->json(['error' => 'unverified_voter'], 422);
            }
        }

        $standing = VoteWeight::for($uid);
        if ($standing['runs'] === 0) {
            return response()->json(['error' => 'Play a match before voting.'], 422);
        }

        // Create-first: a check-then-insert here races under concurrency,
        // so the unique (proposal_id, uid) index is the real guard and its
        // violation maps back to the duplicate-vote conflict.
        try {
            $vote = ChallengeVote::create([
                'proposal_id' => $proposal->id,
                'uid' => $uid,
                'weight' => $standing['weight'],
            ]);
        } catch (QueryException $exception) {
            if ($exception->getCode() === '23000') {
                return response()->json(['error' => 'Already voted for this proposal.'], 409);
            }
            throw $exception;
        }

        return response()->json([
            'id' => $vote->id,
            'weight' => $standing['weight'],
            'breakdown' => [
                'base' => VoteWeight::BASE,
                'badges' => $standing['badges'],
                'top3' => $standing['top3'],
            ],
        ], 201);
    }

    /**
     * Strict v1 asset check: exact keys, swatch allowlist, integer counts
     * in bounds, finite scales in range. Unknown keys fail — gameplay
     * smuggling cannot ride the dressing along.
     */
    private static function checkAssets(mixed $value, Closure $fail): void
    {
        if (! is_array($value)) {
            $fail('The assets must be an object.');

            return;
        }
        $encoded = json_encode($value);
        if ($encoded === false || strlen($encoded) > self::ASSET_MAX_BYTES) {
            $fail('The assets payload is too large.');

            return;
        }
        $top = ['version', 'palette', 'scenery', 'moon', 'towers'];
        if (count(array_diff($top, array_keys($value))) > 0
            || count(array_diff(array_keys($value), $top)) > 0) {
            $fail('The assets must hold exactly version, palette, scenery, moon, towers.');

            return;
        }
        $legacy = ($value['version'] ?? null) === 1;
        if (! $legacy && ($value['version'] ?? null) !== 2) {
            $fail('The assets version must be 1 or 2.');

            return;
        }
        $palette = $value['palette'] ?? null;
        if (! is_array($palette)
            || count(array_diff(['moon', 'crater', 'accent', 'crane'], array_keys($palette))) > 0
            || count(array_diff(array_keys($palette), ['moon', 'crater', 'accent', 'crane'])) > 0) {
            $fail('The palette must hold exactly moon, crater, accent, crane.');

            return;
        }
        foreach ($palette as $swatch) {
            if (! is_string($swatch) || ! in_array($swatch, self::ASSET_SWATCHES, true)) {
                $fail('The palette holds an unknown swatch.');

                return;
            }
        }
        $bounds = ['trees' => 24, 'clouds' => 8, 'beacons' => 12, 'pennants' => 20, 'shrooms' => 16, 'lanterns' => 12];
        $wantedScenery = $legacy
            ? ['trees', 'clouds', 'beacons', 'pennants', 'shrooms']
            : array_keys($bounds);
        $scenery = $value['scenery'] ?? null;
        if (! is_array($scenery)
            || count(array_diff($wantedScenery, array_keys($scenery))) > 0
            || count(array_diff(array_keys($scenery), $wantedScenery)) > 0) {
            $fail('The scenery holds the wrong keys for its version.');

            return;
        }
        foreach ($bounds as $key => $max) {
            if ($legacy && $key === 'lanterns') {
                continue;
            }
            if (! is_int($scenery[$key]) || $scenery[$key] < 0 || $scenery[$key] > $max) {
                $fail("The scenery.{$key} count is out of bounds.");

                return;
            }
        }
        $wantedMoon = $legacy ? ['craters', 'size'] : ['craters', 'size', 'halo'];
        $moon = $value['moon'] ?? null;
        if (! is_array($moon)
            || count(array_diff($wantedMoon, array_keys($moon))) > 0
            || count(array_diff(array_keys($moon), $wantedMoon)) > 0) {
            $fail('The moon holds the wrong keys for its version.');

            return;
        }
        if (! is_int($moon['craters']) || $moon['craters'] < 0 || $moon['craters'] > 24) {
            $fail('The moon.craters count is out of bounds.');

            return;
        }
        if (! self::inScale($moon['size'] ?? null, 0.7, 1.4)) {
            $fail('The moon.size scale is out of bounds.');

            return;
        }
        if (! $legacy && ! self::inScale($moon['halo'] ?? null, 0.0, 1.0)) {
            $fail('The moon.halo scale is out of bounds.');

            return;
        }
        $towers = $value['towers'] ?? null;
        $wantedTowers = $legacy ? ['heightScale'] : ['heightScale', 'widthScale'];
        if (! is_array($towers) || array_keys($towers) !== $wantedTowers) {
            $fail('The towers hold the wrong keys for their version.');

            return;
        }
        if (! self::inScale($towers['heightScale'] ?? null, 0.6, 1.6)) {
            $fail('The towers.heightScale scale is out of bounds.');

            return;
        }
        if (! $legacy && ! self::inScale($towers['widthScale'] ?? null, 0.6, 1.6)) {
            $fail('The towers.widthScale scale is out of bounds.');
        }
    }

    private static function inScale(mixed $value, float $low, float $high): bool
    {
        if (! is_int($value) && ! is_float($value)) {
            return false;
        }

        return is_finite((float) $value) && $value >= $low && $value <= $high;
    }

    /** @return array<string, mixed> */
    private function rowFor(ChallengeProposal $proposal): array
    {
        $weighted = (float) ($proposal->weighted_votes ?? $proposal->votes()->sum('weight'));

        return [
            'id' => $proposal->id,
            'uid' => $proposal->uid,
            'nickname' => $proposal->nickname,
            'title' => $proposal->title,
            'description' => $proposal->description,
            'model' => $proposal->model,
            'input_prompt' => $proposal->input_prompt,
            'output_format' => $proposal->output_format,
            'restrictions' => $proposal->restrictions,
            'assets' => $proposal->assets,
            'votes' => (int) ($proposal->votes_count ?? $proposal->votes()->count()),
            'weighted_votes' => $weighted,
            'featured' => $weighted >= self::FEATURED_WEIGHTED_VOTES,
            'created_at' => $proposal->created_at?->toIso8601String(),
        ];
    }
}
