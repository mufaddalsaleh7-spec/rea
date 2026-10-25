<?php

declare(strict_types=1);

/**
 * Drive `public/index.php` the way a web server does.
 *
 * The front controller is the production entry point, and a parity test that
 * only exercises the router would leave it unproven. This shim fills in the
 * superglobals PHP would have populated, then includes the real file; `exit`
 * inside the controller ends the run, exactly as it ends a request.
 *
 * Descriptor: {"uri": "...", "method": "GET", "query": {...}}
 */
$descriptorPath = '/tmp/front.json';
$descriptor = is_file($descriptorPath)
    ? json_decode((string) file_get_contents($descriptorPath), true)
    : ['uri' => '/api/company'];

$_SERVER['REQUEST_URI'] = (string) ($descriptor['uri'] ?? '/api/company');
$_SERVER['REQUEST_METHOD'] = (string) ($descriptor['method'] ?? 'GET');
$_SERVER['CONTENT_LENGTH'] = '0';
$_SERVER['HTTP_HOST'] = 'localhost';
$_GET = is_array($descriptor['query'] ?? null) ? $descriptor['query'] : [];

require __DIR__ . '/../public/index.php';
