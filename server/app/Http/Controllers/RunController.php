<?php

namespace App\Http\Controllers;

use App\Models\Run;
use App\Rules\NoControlChars;
use App\Services\RunReceipt;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;

class RunController extends Controller
{
    public const MAX_JSON_BLOB_BYTES = 4096;

    /**
     * Store one scored run. The simulator computes the metrics; the server
     * validates the JSON shape, verifies the sim's receipt when the board
     * secret is configured, persists the row, and derives the rank.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'uid' => 'required|string|max:128',
            'game' => 'required|string|in:city,tote',
            'challenge' => 'nullable|string|max:64',
            'seed' => 'required|integer',
            'model' => 'required|string|max:64',
            'provider' => 'required|string|max:64',
            'nickname' => ['nullable', 'string', 'max:32', new NoControlChars],
            'badges' => 'nullable|array|max:8',
            'badges.*' => 'string|max:32',
            'strategy' => ['nullable', 'array', 'max:8', self::jsonSizeRule()],
            'strategy.mean_allocation' => 'nullable|array|max:8',
            'strategy.mean_allocation.*' => 'numeric',
            'strategy.policies' => 'nullable|array|max:16',
            'strategy.policies.*' => 'numeric',
            'strategy.played_turns' => 'nullable|integer',
            'strategy.skipped_turns' => 'nullable|integer',
            // City metrics are 0-100 by construction (weighted sub-scores
            // and impact-per-cost); tote scores bottom out at 0 with a
            // generous ceiling for catalog growth.
            'impact' => 'required_if:game,city|nullable|numeric|min:0|max:100',
            'efficiency' => 'required_if:game,city|nullable|numeric|min:0|max:100',
            'score' => 'required_if:game,tote|nullable|numeric|min:0|max:1000',
            'details' => ['nullable', 'array', 'max:32', self::jsonSizeRule()],
            'receipt' => 'nullable|array',
            'receipt.payload' => 'required_with:receipt|string|max:8192',
            'receipt.sig' => 'required_with:receipt|string|max:128',
        ]);

        if (RunReceipt::requiresReceipt()) {
            $payload = RunReceipt::verify($validated['receipt'] ?? null);
            if ($payload === null || ! RunReceipt::matchesRun($payload, $validated)) {
                return response()->json(['error' => 'unverified_run'], 422);
            }
        }

        $run = Run::create(Arr::except($validated, ['receipt']));
        $metric = $run->game === 'city' ? 'impact' : 'score';

        return response()->json([
            'id' => $run->id,
            'position' => LeaderboardController::positionFor($run, $metric),
        ], 201);
    }

    /**
     * Cap an array payload's encoded size so deep nesting cannot bloat
     * the JSON column past the count rules above.
     */
    private static function jsonSizeRule(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail): void {
            $encoded = json_encode($value);
            if ($encoded === false || strlen($encoded) > self::MAX_JSON_BLOB_BYTES) {
                $fail("The {$attribute} payload is too large.");
            }
        };
    }
}
