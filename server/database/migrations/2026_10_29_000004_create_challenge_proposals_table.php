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
        Schema::create('challenge_proposals', function (Blueprint $table) {
            $table->id();
            $table->string('uid', 128)->index();
            $table->string('nickname', 32)->nullable();
            $table->string('title', 80);
            $table->text('description');
            $table->string('model', 64);
            $table->text('input_prompt');
            $table->string('output_format', 255);
            $table->text('restrictions')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('challenge_proposals');
    }
};
