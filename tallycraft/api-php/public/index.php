<?php

declare(strict_types=1);

/**
 * Front controller for the PHP build.
 *
 *   php -S 0.0.0.0:8080 -t api-php/public
 *
 * Serves the JSON API at /api/*, the health probe at /healthz, the React app at
 * /app/ (from public/react) and the legacy client everywhere else, mirroring
 * the Node server so both backends are interchangeable behind one URL.
 */

use TallyCraft\Bootstrap;
use TallyCraft\Json;
use TallyCraft\Router;
use TallyCraft\Seed;

$root = dirname(__DIR__);
require $root . '/autoload.php';

$bootstrap = new Bootstrap(Bootstrap::config());
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

/** Serve a file from disk with a sane content type, or return false. */
$serveFile = static function (string $file): bool {
    if (!is_file($file)) {
        return false;
    }
    $types = [
        'html' => 'text/html; charset=utf-8',
        'css' => 'text/css; charset=utf-8',
        'js' => 'text/javascript; charset=utf-8',
        'json' => 'application/json; charset=utf-8',
        'webmanifest' => 'application/manifest+json; charset=utf-8',
        'png' => 'image/png',
        'svg' => 'image/svg+xml',
        'ico' => 'image/x-icon',
        'xml' => 'application/xml; charset=utf-8',
    ];
    $extension = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    header('content-type: ' . ($types[$extension] ?? 'application/octet-stream'));
    header('cache-control: no-cache');
    readfile($file);

    return true;
};

// A booked company is the reason to open the app; seed on first request so a
// fresh container is not an empty screen.
if ($method === 'GET' && ($path === '/' || $path === '/app' || $path === '/app/')) {
    $companies = (int) $bootstrap->db->query('SELECT COUNT(*) FROM companies')->fetchColumn();
    if ($companies === 0) {
        (new Seed($bootstrap->db, (string) $bootstrap->config['seedPath'], $bootstrap->catalog))->load();
    }
    header('location: /app/');
    http_response_code(302);
    exit;
}

if (str_starts_with($path, '/api/') || $path === '/healthz') {
    $router = new Router($bootstrap);
    $body = $method === 'POST' ? file_get_contents('php://input') : null;
    $result = $router->handle($method, $path, $_GET, $body);
    http_response_code($result['status']);
    if (is_string($result['body'])) {
        header('content-type: text/plain; charset=utf-8');
        header('cache-control: no-store');
        echo $result['body'];
        exit;
    }
    Json::body($result['body']);
}

// The React build.
$webRoot = $bootstrap->config['webDir'];
if (str_starts_with($path, '/app')) {
    $relative = ltrim(substr($path, strlen('/app')), '/');
    if ($relative === '') {
        $relative = 'index.html';
    }
    $file = realpath($webRoot . '/react/' . $relative);
    if ($file !== false && str_starts_with($file, (string) realpath($webRoot . '/react')) && $serveFile($file)) {
        exit;
    }
    http_response_code(404);
    echo 'Not found';
    exit;
}

// Everything else is the classic client, served from public/.
$relative = ltrim($path, '/');
if ($relative === '') {
    $relative = 'index.html';
}
$file = realpath($webRoot . '/' . $relative);
if ($file !== false && str_starts_with($file, (string) realpath($webRoot)) && $serveFile($file)) {
    exit;
}
$file = realpath($webRoot . '/index.html');
if ($file !== false && $serveFile($file)) {
    exit;
}
http_response_code(404);
echo 'Client build is missing';
