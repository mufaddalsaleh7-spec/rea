<?php

declare(strict_types=1);

/**
 * Parity harness entry point.
 *
 * Reads a JSON request list, runs each one through the real router, writes a
 * JSON response list. No web server, no superglobals: `php-wasm` can execute
 * this file directly, which is how CI proves the PHP backend answers the same
 * as the Node one.
 *
 *   php tests/runner.php <requests.json >responses.json
 */

use TallyCraft\Bootstrap;
use TallyCraft\Json;
use TallyCraft\Router;

$root = dirname(__DIR__);
require $root . '/autoload.php';

// Three ways in, in order: a harness descriptor file (php-wasm has no argv),
// command-line arguments (php tests/runner.php db.json requests.json), or stdin.
$descriptorPath = __DIR__ . '/../data/harness.json';
$descriptor = is_file($descriptorPath)
    ? json_decode((string) file_get_contents($descriptorPath), true)
    : null;

$dbArgument = $descriptor['db'] ?? ($argv[1] ?? null);
$requestsArgument = $descriptor['requests'] ?? ($argv[2] ?? null);

$raw = '';
if ($requestsArgument !== null && is_file((string) $requestsArgument)) {
    $raw = (string) file_get_contents((string) $requestsArgument);
} elseif (defined('STDIN')) {
    $raw = (string) stream_get_contents(STDIN);
}
$requests = json_decode($raw === '' ? '[]' : $raw, true, 512, JSON_THROW_ON_ERROR);

$env = getenv();
$env['TALLYCRAFT_DB'] = $dbArgument ?? ($env['TALLYCRAFT_DB'] ?? 'data/tallycraft.db');
$bootstrap = new Bootstrap(Bootstrap::config($env, $root));
$router = new Router($bootstrap);

$responses = [];
foreach ($requests as $request) {
    $result = $router->handle(
        (string) ($request['method'] ?? 'GET'),
        (string) ($request['path'] ?? '/'),
        $request['query'] ?? [],
        $request['body'] ?? null
    );
    $responses[] = [
        'status' => $result['status'],
        'body' => $result['body'],
        'json' => is_string($result['body']) ? null : Json::encode($result['body']),
    ];
}

echo json_encode($responses, JSON_UNESCAPED_SLASHES);
