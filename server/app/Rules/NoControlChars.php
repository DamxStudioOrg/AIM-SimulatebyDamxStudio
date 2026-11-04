<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Reject ASCII control characters in stored text. Board rows render
 * in many clients; control bytes have no business in them.
 */
class NoControlChars implements ValidationRule
{
    /**
     * @param  string  $attribute
     * @param  mixed  $value
     */
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value)) {
            return;
        }
        if (preg_match('/[\x00-\x1F\x7F]/', $value) === 1) {
            $fail("The {$attribute} must not contain control characters.");
        }
    }
}
