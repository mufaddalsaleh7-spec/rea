<?php

declare(strict_types=1);

namespace VectorStudio;

use PDO;
use Throwable;
use VectorStudio\Controllers\AssetsController;
use VectorStudio\Controllers\DocumentsController;
use VectorStudio\Controllers\HealthController;
use VectorStudio\Controllers\SettingsController;
use VectorStudio\Http\HttpError;
use VectorStudio\Http\Request;
use VectorStudio\Http\Response;
use VectorStudio\Http\Router;
use VectorStudio\Storage\AssetRepository;
use VectorStudio\Storage\Database;
use VectorStudio\Storage\DocumentRepository;
use VectorStudio\Storage\SettingsRepository;
use VectorStudio\Support\Config;

/**
 * Application composition root: database, repositories, controllers, routing
 * and the static/SPA fallback that serves the built React bundle.
 */
final class App
{
    private Router $router;

    public function __construct(private readonly Config $config, PDO $pdo)
    {
        $this->config->ensureStorage();
        $documents = new DocumentRepository($pdo, $config->maxRevisions);
        $assets = new AssetRepository($pdo, $config->storageDir . '/assets', $config->maxAssetBytes);
        $settings = new SettingsRepository($pdo);
        $this->router = $this->buildRouter(
            new DocumentsController($documents, $assets, $config),
            new AssetsController($assets, $documents),
            new SettingsController($settings),
            new HealthController($config, $documents),
        );
    }

    public static function boot(Config $config): self
    {
        return new self($config, Database::connect($config->databasePath()));
    }

    /** In-memory variant for tests. */
    public static function inMemory(Config $config): self
    {
        return new self($config, Database::connect(':memory:'));
    }

    private function buildRouter(
        DocumentsController $documents,
        AssetsController $assets,
        SettingsController $settings,
        HealthController $health,
    ): Router {
        $router = new Router();

        $router->get('/api/health', [$health, 'show']);
        $router->get('/api/config', [$health, 'show']);

        $router->get('/api/documents', [$documents, 'index']);
        $router->post('/api/documents', [$documents, 'create']);
        $router->get('/api/documents/{id}', [$documents, 'show']);
        $router->put('/api/documents/{id}', [$documents, 'update']);
        $router->patch('/api/documents/{id}', [$documents, 'update']);
        $router->delete('/api/documents/{id}', [$documents, 'delete']);
        $router->get('/api/documents/{id}/revisions', [$documents, 'revisions']);
        $router->post('/api/documents/{id}/revisions/{revision}/restore', [$documents, 'restore']);
        $router->post('/api/documents/{id}/restore', [$documents, 'restore']);
        $router->get('/api/documents/{id}/export', [$documents, 'export']);

        $router->get('/api/documents/{id}/assets', [$assets, 'index']);
        $router->post('/api/documents/{id}/assets', [$assets, 'create']);
        $router->get('/api/assets/{id}', [$assets, 'show']);

        $router->get('/api/settings', [$settings, 'show']);
        $router->put('/api/settings', [$settings, 'update']);

        $router->fallback(fn (Request $request): Response => $this->staticOrShell($request));

        return $router;
    }

    public function handle(Request $request): Response
    {
        try {
            $response = $this->router->dispatch($request);
        } catch (HttpError $error) {
            $response = $error->toResponse();
        } catch (Throwable $error) {
            error_log('[vectorstudio] ' . $error->getMessage() . ' @ ' . $error->getFile() . ':' . $error->getLine());
            $response = Response::json([
                'error' => 'Internal server error',
                'status' => 500,
            ], 500);
        }

        return $this->withCors($request, $response);
    }

    private function withCors(Request $request, Response $response): Response
    {
        if (!$this->config->devCors) {
            return $response;
        }
        $headers = $response->headerList() + [
            'access-control-allow-origin' => $request->header('origin') ?? '*',
            'access-control-allow-methods' => 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'access-control-allow-headers' => 'content-type, accept',
            'access-control-max-age' => '600',
            'vary' => 'origin',
        ];

        return new Response($response->status, $response->body, $headers);
    }

    /** Serve a built asset, or the SPA shell for client-side routes. */
    private function staticOrShell(Request $request): Response
    {
        $path = $request->path;
        if (str_starts_with($path, '/api/')) {
            throw HttpError::notFound('Endpoint ' . $path);
        }
        $relative = ltrim(rawurldecode($path), '/');
        if ($relative !== '' && !str_contains($relative, '..')) {
            foreach ($this->config->staticRoots as $root) {
                $candidate = $root . '/' . $relative;
                if (is_file($candidate)) {
                    return new Response(200, (string) file_get_contents($candidate), [
                        'content-type' => self::mimeFor($candidate),
                        'cache-control' => str_starts_with($relative, 'assets/')
                            ? 'public, max-age=31536000, immutable'
                            : 'no-cache',
                    ]);
                }
            }
        }
        foreach ($this->config->staticRoots as $root) {
            $index = $root . '/index.html';
            if (is_file($index)) {
                return new Response(200, (string) file_get_contents($index), [
                    'content-type' => 'text/html; charset=utf-8',
                    'cache-control' => 'no-cache',
                ]);
            }
        }
        throw HttpError::notFound('Application bundle. Run "npm run build" first.');
    }

    private static function mimeFor(string $path): string
    {
        return match (strtolower(pathinfo($path, PATHINFO_EXTENSION))) {
            'html' => 'text/html; charset=utf-8',
            'js', 'mjs' => 'text/javascript; charset=utf-8',
            'css' => 'text/css; charset=utf-8',
            'json' => 'application/json; charset=utf-8',
            'svg' => 'image/svg+xml',
            'png' => 'image/png',
            'jpg', 'jpeg' => 'image/jpeg',
            'webp' => 'image/webp',
            'ico' => 'image/x-icon',
            'woff2' => 'font/woff2',
            'map' => 'application/json; charset=utf-8',
            'txt' => 'text/plain; charset=utf-8',
            default => 'application/octet-stream',
        };
    }
}
