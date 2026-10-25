<?php

declare(strict_types=1);

namespace VectorStudio\Http;

/**
 * Immutable view over one HTTP request.
 *
 * The request is built from superglobals by {@see fromGlobals()} but tests and
 * the PHP-WASM bridge construct it directly, which keeps every handler free of
 * environment coupling.
 */
final class Request
{
    /**
     * @param array<string, string> $headers
     * @param array<string, mixed>  $query
     * @param array<string, mixed>  $body
     */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $query = [],
        public readonly array $body = [],
        public readonly array $headers = [],
        public readonly string $rawBody = '',
        public readonly array $routeParams = [],
    ) {
    }

    public static function fromGlobals(): self
    {
        $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
        $path = parse_url($uri, PHP_URL_PATH);
        $raw = (string) file_get_contents('php://input');
        $body = [];

        if ($raw !== '' && str_contains((string) ($_SERVER['CONTENT_TYPE'] ?? ''), 'json')) {
            $decoded = json_decode($raw, true);
            $body = is_array($decoded) ? $decoded : [];
        } elseif ($raw !== '' && isset($_POST)) {
            $body = $_POST;
        }

        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (str_starts_with($key, 'HTTP_')) {
                $name = strtolower(str_replace('_', '-', substr($key, 5)));
                $headers[$name] = (string) $value;
            }
        }

        return new self($method, (string) $path, $_GET, $body, $headers, $raw);
    }

    /** Route parameters filled in by the router once a route matches. */
    public function withParams(array $params): self
    {
        return new self(
            $this->method,
            $this->path,
            $this->query,
            $this->body,
            $this->headers,
            $this->rawBody,
            $params,
        );
    }

    public function param(string $name, ?string $default = null): ?string
    {
        $value = $this->routeParams[$name] ?? $default;

        return $value === null ? null : (string) $value;
    }

    public function queryParam(string $name, ?string $default = null): ?string
    {
        $value = $this->query[$name] ?? $default;

        return is_scalar($value) ? (string) $value : $default;
    }

    public function intQuery(string $name, int $default, int $min, int $max): int
    {
        $raw = $this->queryParam($name);
        $value = $raw === null ? $default : (int) $raw;

        return max($min, min($max, $value));
    }

    /** @return array<string, mixed> */
    public function json(): array
    {
        return $this->body;
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }
}
