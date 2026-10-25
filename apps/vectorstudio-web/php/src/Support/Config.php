<?php

declare(strict_types=1);

namespace VectorStudio\Support;

/** Runtime configuration resolved from the environment with safe defaults. */
final class Config
{
    /**
     * @param list<string> $staticRoots
     */
    public function __construct(
        public readonly string $storageDir,
        public readonly string $publicDir,
        public readonly int $maxDocumentBytes = 8_388_608,
        public readonly int $maxAssetBytes = 12_582_912,
        public readonly int $maxRevisions = 40,
        public readonly array $staticRoots = [],
        public readonly bool $devCors = true,
    ) {
    }

    public static function fromEnvironment(string $baseDir): self
    {
        $storage = getenv('VECTORSTUDIO_STORAGE') ?: $baseDir . '/storage';
        $public = getenv('VECTORSTUDIO_PUBLIC') ?: $baseDir . '/public';
        $dist = getenv('VECTORSTUDIO_DIST') ?: dirname($baseDir, 2) . '/dist';

        return new self(
            storageDir: rtrim($storage, '/'),
            publicDir: rtrim($public, '/'),
            maxDocumentBytes: (int) (getenv('VECTORSTUDIO_MAX_DOCUMENT_BYTES') ?: 8_388_608),
            maxAssetBytes: (int) (getenv('VECTORSTUDIO_MAX_ASSET_BYTES') ?: 12_582_912),
            maxRevisions: (int) (getenv('VECTORSTUDIO_MAX_REVISIONS') ?: 40),
            staticRoots: array_values(array_filter([rtrim($dist, '/'), rtrim($public, '/')])),
            devCors: (getenv('VECTORSTUDIO_DEV_CORS') ?: '1') === '1',
        );
    }

    /**
     * Prepare the storage tree. The root must be usable; the asset/export
     * subdirectories are created eagerly but their failure is not fatal — the
     * repositories create them on demand, which keeps read-only deployments
     * (and runtimes with a stale directory cache) serving documents.
     */
    public function ensureStorage(): void
    {
        clearstatcache();
        if (!self::ensureDir($this->storageDir)) {
            throw new \RuntimeException('Cannot create storage directory: ' . $this->storageDir);
        }
        foreach (['assets', 'exports'] as $sub) {
            self::ensureDir($this->storageDir . '/' . $sub);
        }
    }

    private static function ensureDir(string $path): bool
    {
        clearstatcache(true, $path);
        if (is_dir($path)) {
            return true;
        }
        if (@mkdir($path, 0o775, true)) {
            return true;
        }
        clearstatcache(true, $path);

        return is_dir($path);
    }

    public function databasePath(): string
    {
        return $this->storageDir . '/vectorstudio.sqlite';
    }
}
