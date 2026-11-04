<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ChallengeVote extends Model
{
    /** @var list<string> */
    protected $fillable = [
        'proposal_id',
        'uid',
        'weight',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'proposal_id' => 'integer',
            'weight' => 'float',
        ];
    }
}
