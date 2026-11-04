<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('challenge_votes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('proposal_id')->constrained('challenge_proposals')->cascadeOnDelete();
            $table->string('uid', 128)->index();
            $table->float('weight');
            $table->timestamps();
            $table->unique(['proposal_id', 'uid']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('challenge_votes');
    }
};
