<?php

declare(strict_types=1);

namespace VectorStudio\Http;

/** Small immutable response value object with JSON and file helpers. */
final class Response
{
    /** @param array<string, string> $headers */
    public function __construct(
        public readonly int $status = 200,
        public readonly string $body = '',
        public readonly array $headers = [],
    ) {
    }

    public static function json(mixed $data, int $status = 200): self
    {
        $json = json_encode(
            $data,
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION,
        );

        return new self($status, $json === false ? '{}' : $json, [
            'content-type' => 'application/json; charset=utf-8',
            'cache-control' => 'no-store',
        ]);
    }

    public static function text(string $body, int $status = 200): self
    {
        return new self($status, $body, ['content-type' => 'text/plain; charset=utf-8']);
    }

    /** @param array<string, string> $extra */
    public static function download(string $body, string $mime, string $filename, array $extra = []): self
    {
        return new self(200, $body, [
            'content-type' => $mime,
            'content-disposition' => 'attachment; filename="' . addslashes($filename) . '"',
            'cache-control' => 'no-store',
        ] + $extra);
    }

    public static function empty(int $status = 204): self
    {
        return new self($status, '', []);
    }

    public static function file(string $path, ?string $mime = null): self
    {
        $body = (string) file_get_contents($path);
        $mime ??= 'application/octet-stream';

        return new self(200, $body, [
            'content-type' => $mime,
            'cache-control' => 'no-cache',
        ]);
    }

    /** @return array<string, string> */
    public function headerList(): array
    {
        return $this->headers;
    }
}
