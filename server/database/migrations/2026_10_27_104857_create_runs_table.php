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
        Schema::create('runs', function (Blueprint $table) {
            $table->id();
            $table->string('uid', 128);
            $table->string('game', 16);
            $table->integer('seed');
            $table->string('model', 64);
            $table->string('provider', 64);
            $table->double('impact')->nullable();
            $table->double('efficiency')->nullable();
            $table->double('score')->nullable();
            $table->json('details')->nullable();
            $table->timestamps();
            $table->index(['game', 'uid']);
            $table->index(['game', 'impact']);
            $table->index(['game', 'efficiency']);
            $table->index(['game', 'score']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('runs');
    }
};
