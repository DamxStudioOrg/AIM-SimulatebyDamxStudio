<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ChallengeProposal extends Model
{
    /** @var list<string> */
    protected $fillable = [
        'uid',
        'nickname',
        'title',
        'description',
        'model',
        'input_prompt',
        'output_format',
        'restrictions',
        'assets',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'assets' => 'array',
        ];
    }

    /** @return HasMany<ChallengeVote, $this> */
    public function votes(): HasMany
    {
        return $this->hasMany(ChallengeVote::class, 'proposal_id');
    }
}
