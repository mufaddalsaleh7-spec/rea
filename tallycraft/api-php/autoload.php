<?php

declare(strict_types=1);

/**
 * Class autoloader.
 *
 * One namespace, one directory, no Composer: the deployment story stays
 * "copy the files and run php -S", and the front controller has no build step
 * to forget.
 */

spl_autoload_register(static function (string $class): void {
    $prefix = 'TallyCraft\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $file = __DIR__ . '/src/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
    if (is_file($file)) {
        require $file;
    }
});
