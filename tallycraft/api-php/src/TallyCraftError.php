<?php

declare(strict_types=1);

namespace TallyCraft;

/**
 * A refusal the client is meant to read.
 *
 * The code string is part of the API contract: the Node backend returns the
 * same codes, the React client switches on them, and the parity test asserts
 * them. `details` carries whatever helps the caller fix the input.
 */
final class TallyCraftError extends \RuntimeException
{
    /** @param array<string, mixed>|null $details */
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly ?array $details = null,
    ) {
        parent::__construct($message);
    }
}
