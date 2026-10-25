<?php

declare(strict_types=1);

namespace VectorStudio\Http;

/**
 * Minimal path router with `{param}` placeholders and an ordered route table.
 * Routes are matched in declaration order so literal paths win over params
 * when the table is authored top-down.
 */
final class Router
{
    /** @var array<int, array{method: string, pattern: string, handler: callable}> */
    private array $routes = [];

    /** @var null|callable(Request): Response */
    private $fallback = null;

    public function get(string $pattern, callable $handler): void
    {
        $this->add('GET', $pattern, $handler);
    }

    public function post(string $pattern, callable $handler): void
    {
        $this->add('POST', $pattern, $handler);
    }

    public function put(string $pattern, callable $handler): void
    {
        $this->add('PUT', $pattern, $handler);
    }

    public function patch(string $pattern, callable $handler): void
    {
        $this->add('PATCH', $pattern, $handler);
    }

    public function delete(string $pattern, callable $handler): void
    {
        $this->add('DELETE', $pattern, $handler);
    }

    /** Handler for requests no API route matched (static files / SPA shell). */
    public function fallback(callable $handler): void
    {
        $this->fallback = $handler;
    }

    public function add(string $method, string $pattern, callable $handler): void
    {
        $this->routes[] = ['method' => strtoupper($method), 'pattern' => $pattern, 'handler' => $handler];
    }

    public function dispatch(Request $request): Response
    {
        foreach ($this->routes as $route) {
            $params = $this->match($route['pattern'], $request->path);
            if ($params === null) {
                continue;
            }
            if ($route['method'] !== $request->method && !($route['method'] === 'GET' && $request->method === 'HEAD')) {
                continue;
            }

            return ($route['handler'])($request->withParams($params));
        }

        if ($this->fallback !== null) {
            return ($this->fallback)($request);
        }

        throw HttpError::notFound('Route ' . $request->path);
    }

    /** @return array<string, string>|null */
    private function match(string $pattern, string $path): ?array
    {
        if ($pattern === $path) {
            return [];
        }
        $regex = preg_replace_callback(
            '/\{([a-z][a-z0-9_]*)\}/i',
            static fn (array $m): string => '(?P<' . $m[1] . '>[A-Za-z0-9_.\-]+)',
            $pattern,
        );
        if ($regex === null) {
            return null;
        }
        if (!preg_match('#^' . $regex . '$#', $path, $matches)) {
            return null;
        }

        $params = [];
        foreach ($matches as $key => $value) {
            if (is_string($key)) {
                $params[$key] = $value;
            }
        }

        return $params;
    }
}
