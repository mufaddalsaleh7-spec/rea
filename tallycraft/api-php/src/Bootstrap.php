<?php

declare(strict_types=1);

namespace TallyCraft;

use PDO;

/**
 * Application bootstrap: configuration, database, schema, service.
 *
 * Deliberately small and side-effect-light so the same object can be built by
 * `public/index.php` (real HTTP) and by `tests/runner.php` (the parity harness
 * that runs this backend inside php-wasm).
 */
final class Bootstrap
{
    public PDO $db;
    public Catalog $catalog;
    public TallyCraft $app;

    /**
     * @param array<string, mixed> $config
     */
    public function __construct(public readonly array $config)
    {
        $dbPath = (string) $config['dbPath'];
        $directory = dirname($dbPath);
        if ($dbPath !== ':memory:' && !is_dir($directory)) {
            mkdir($directory, 0o777, true);
        }
        $this->db = new PDO('sqlite:' . $dbPath, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT => 5,
        ]);
        // WAL is what a busy server wants; some hosts (and the php-wasm test
        // harness) only have a plain VFS, so a refusal here is not fatal.
        try {
            $this->db->exec('PRAGMA journal_mode = WAL');
        } catch (\PDOException) {
            $this->db->exec('PRAGMA journal_mode = DELETE');
        }
        $this->db->exec('PRAGMA foreign_keys = ON');
        $this->db->exec((string) file_get_contents(__DIR__ . '/schema.sql'));

        $this->catalog = Catalog::load((string) $config['catalogPath']);
        $this->syncGroups();
        $this->app = new TallyCraft($this->db, $this->catalog);
    }

    /** Keep the `groups` table equal to the generated catalogue, idempotently. */
    private function syncGroups(): void
    {
        $statement = $this->db->prepare(
            'INSERT INTO groups (name, parent, nature, natural, predefined)
             VALUES (?, ?, ?, ?, 1)
             ON CONFLICT(name) DO UPDATE SET parent = excluded.parent, nature = excluded.nature, natural = excluded.natural'
        );
        $this->db->beginTransaction();
        try {
            foreach ($this->catalog->groups as $group) {
                $statement->execute([
                    $group['name'],
                    $group['parent'],
                    $group['nature'],
                    $group['natural'],
                ]);
            }
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
    }

    /**
     * Resolve configuration from the environment, the same variables the Node
     * server reads, so one `.env` configures either backend.
     *
     * @param array<string, string|false>|null $env
     */
    public static function config(?array $env = null, ?string $root = null): array
    {
        $env ??= getenv();
        $root ??= dirname(__DIR__);
        $db = self::env($env, 'TALLYCRAFT_DB', 'data/tallycraft.db');
        $isAbsolute = str_starts_with($db, '/') || preg_match('/^[A-Za-z]:[\\\\\\/]/', $db) === 1;

        return [
            'dbPath' => $isAbsolute ? $db : $root . '/' . $db,
            'catalogPath' => $root . '/data/catalog.json',
            'seedPath' => $root . '/data/seed.json',
            'publicDir' => $root . '/public',
            'webDir' => dirname($root) . '/public',
            'environment' => self::env($env, 'NODE_ENV', 'development'),
            'release' => self::env($env, 'TALLYCRAFT_RELEASE', 'php'),
            'port' => (int) self::env($env, 'PORT', '8080'),
        ];
    }

    /** @param array<string, string|false> $env */
    private static function env(array $env, string $key, string $fallback): string
    {
        $value = $env[$key] ?? false;

        return $value === false || $value === '' ? $fallback : (string) $value;
    }
}
