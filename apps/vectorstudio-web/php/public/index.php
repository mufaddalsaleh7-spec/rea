<?php

declare(strict_types=1);

/**
 * Front controller.
 *
 * Development:  php -S 127.0.0.1:8080 -t public public/index.php
 * Production:   point the document root at this directory, everything else
 *               (assets, API, SPA routes) is handled here.
 */

$config = require dirname(__DIR__) . '/bootstrap.php';

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($method === 'OPTIONS') {
    header('access-control-allow-origin: ' . ($_SERVER['HTTP_ORIGIN'] ?? '*'));
    header('access-control-allow-methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('access-control-allow-headers: content-type, accept');
    header('access-control-max-age: 600');
    http_response_code(204);
    exit;
}

$app = \VectorStudio\App::boot($config);
$response = $app->handle(\VectorStudio\Http\Request::fromGlobals());

http_response_code($response->status);
foreach ($response->headerList() as $name => $value) {
    header($name . ': ' . $value);
}
if ($method !== 'HEAD') {
    echo $response->body;
}
