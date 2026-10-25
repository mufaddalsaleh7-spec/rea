<?php

declare(strict_types=1);

namespace VectorStudio\Http;

use RuntimeException;

/** Application error that maps onto an HTTP status code. */
final class HttpError extends RuntimeException
{
    /** @param array<string, mixed> $details */
    public function __construct(
        public readonly int $status,
        string $message,
        public readonly array $details = [],
    ) {
        parent::__construct($message);
    }

    public static function notFound(string $what = 'Resource'): self
    {
        return new self(404, $what . ' not found');
    }

    public static function badRequest(string $message, array $details = []): self
    {
        return new self(400, $message, $details);
    }

    public static function conflict(string $message, array $details = []): self
    {
        return new self(409, $message, $details);
    }

    public static function tooLarge(string $message, array $details = []): self
    {
        return new self(413, $message, $details);
    }

    public function toResponse(): Response
    {
        return Response::json([
            'error' => $this->getMessage(),
            'status' => $this->status,
            'details' => (object) $this->details,
        ], $this->status);
    }
}
