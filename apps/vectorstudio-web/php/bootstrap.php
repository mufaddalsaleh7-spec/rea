<?php

declare(strict_types=1);

/**
 * Bootstrap: PSR-4 autoloading for the VectorStudio\ namespace without
 * Composer, so the API runs on any PHP 8.1+ install with zero dependencies.
 */

spl_autoload_register(static function (string $class): void {
    $prefix = 'VectorStudio\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    $path = __DIR__ . '/src/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($path)) {
        require_once $path;
    }
});

require_once __DIR__ . '/src/Support/Config.php';
require_once __DIR__ . '/src/Http/Request.php';
require_once __DIR__ . '/src/Http/Response.php';
require_once __DIR__ . '/src/Http/HttpError.php';
require_once __DIR__ . '/src/Http/Router.php';
require_once __DIR__ . '/src/Storage/Database.php';
require_once __DIR__ . '/src/Storage/DocumentRepository.php';
require_once __DIR__ . '/src/Storage/AssetRepository.php';
require_once __DIR__ . '/src/Storage/SettingsRepository.php';
require_once __DIR__ . '/src/Domain/DocumentValidator.php';
require_once __DIR__ . '/src/Domain/SvgWriter.php';
require_once __DIR__ . '/src/Controllers/HealthController.php';
require_once __DIR__ . '/src/Controllers/DocumentsController.php';
require_once __DIR__ . '/src/Controllers/AssetsController.php';
require_once __DIR__ . '/src/Controllers/SettingsController.php';
require_once __DIR__ . '/src/App.php';

return \VectorStudio\Support\Config::fromEnvironment(__DIR__);
