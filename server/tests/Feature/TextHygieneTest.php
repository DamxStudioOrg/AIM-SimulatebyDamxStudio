<?php

namespace Tests\Feature;

use App\Models\ChallengeProposal;
use App\Models\Run;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Stored text rejects ASCII control characters while markup stays
 * verbatim data for clients to escape at render.
 */
class TextHygieneTest extends TestCase
{
    use RefreshDatabase;

    /** @return array<string, mixed> */
    private function proposal(string $uid = 'author'): array
    {
        return [
            'uid' => $uid,
            'title' => 'Clean drill',
            'description' => 'A trial worth proposing.',
            'model' => 'test-model',
            'input_prompt' => 'Prompt.',
            'output_format' => 'JSON',
        ];
    }

    public function test_control_characters_are_rejected(): void
    {
        foreach (['title', 'description', 'model', 'input_prompt', 'output_format'] as $field) {
            $bad = $this->proposal();
            $bad[$field] = "line one\nline two";
            $this->postJson('/api/challenges/proposals', $bad)->assertUnprocessable();
        }
        $this->assertSame(0, ChallengeProposal::count());

        $badNick = $this->proposal();
        $badNick['nickname'] = "bot\x00name";
        $this->postJson('/api/challenges/proposals', $badNick)->assertUnprocessable();

        $this->postJson('/api/runs', [
            'uid' => 'rider-7',
            'game' => 'city',
            'seed' => 3,
            'model' => 'test-model',
            'provider' => 'stub',
            'impact' => 5.0,
            'efficiency' => 0.5,
            'nickname' => "tab\tname",
        ])->assertUnprocessable();
        $this->assertSame(0, Run::count());
    }

    public function test_plain_text_still_posts(): void
    {
        $this->postJson('/api/challenges/proposals', $this->proposal())->assertCreated();
        $this->assertSame(1, ChallengeProposal::count());
    }
}
