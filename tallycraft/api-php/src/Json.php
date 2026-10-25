<?php

declare(strict_types=1);

namespace TallyCraft;

/** JSON responses shaped exactly like the Node backend's `sendJson`. */
final class Json
{
    public static function encode(mixed $payload): string
    {
        return json_encode(
            $payload,
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
        ) ?: 'null';
    }

    public static function body(mixed $payload): never
    {
        header('content-type: application/json; charset=utf-8');
        header('cache-control: no-store');
        echo self::encode($payload);
        exit;
    }

    public static function error(string $code, string $message, ?array $details = null, int $status = 400): never
    {
        http_response_code($status);
        self::body(['error' => ['code' => $code, 'message' => $message, 'details' => $details]]);
    }
}
