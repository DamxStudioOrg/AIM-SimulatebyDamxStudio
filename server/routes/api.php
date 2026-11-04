<?php

use App\Http\Controllers\AppVersionController;
use App\Http\Controllers\LeaderboardController;
use App\Http\Controllers\ProposalController;
use App\Http\Controllers\RunController;
use Illuminate\Support\Facades\Route;

// Writes are throttled per IP (attempts per hour, named buckets): ids are
// free by design, so flood protection lives on the write endpoints.
Route::post('/runs', [RunController::class, 'store'])->middleware('throttle:runs');
Route::get('/leaderboard', [LeaderboardController::class, 'index']);
Route::get('/app/version', [AppVersionController::class, 'show']);

Route::post('/challenges/proposals', [ProposalController::class, 'store'])
    ->middleware('throttle:proposals');
Route::get('/challenges/proposals', [ProposalController::class, 'index']);
Route::post('/challenges/proposals/{proposal}/votes', [ProposalController::class, 'vote'])
    ->middleware('throttle:votes');
