<?php

declare(strict_types=1);

namespace VectorStudio\Storage;

use PDO;

/** Binary export artefacts (PNG renders, SVG copies) kept beside documents. */
final class AssetRepository
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly string $directory,
        private readonly int $maxBytes = 12_582_912,
    ) {
    }

    /** @param array<string, mixed> $meta */
    public function store(
        string $id,
        ?string $documentId,
        string $filename,
        string $mime,
        string $format,
        string $bytes,
        string $now,
    ): array {
        if (strlen($bytes) > $this->maxBytes) {
            throw new \VectorStudio\Http\HttpError(413, 'Asset exceeds the configured size limit', [
                'limit' => $this->maxBytes,
            ]);
        }
        // Note: a failed mkdir() is not fatal on its own. Runtimes that cache
        // directory stats (php-wasm, some FPM opcache setups) can report the
        // directory as missing while the filesystem still has it. Attempt the
        // write and only fail if it genuinely cannot happen.
        clearstatcache(true, $this->directory);
        if (!is_dir($this->directory)) {
            @mkdir($this->directory, 0o775, true);
        }
        $safe = preg_replace('/[^A-Za-z0-9._-]/', '-', $id) ?? $id;
        $path = $this->directory . '/' . $safe . '.' . $format;
        if (file_put_contents($path, $bytes) === false) {
            clearstatcache(true, $this->directory);
            throw new \RuntimeException(
                is_dir($this->directory)
                    ? 'Cannot write asset: ' . $path
                    : 'Cannot create asset directory: ' . $this->directory,
            );
        }
        $stmt = $this->pdo->prepare('INSERT INTO assets (id, document_id, filename, mime, bytes, format, created_at)
            VALUES (:id, :doc, :filename, :mime, :bytes, :format, :now)');
        $stmt->execute([
            'id' => $id,
            'doc' => $documentId,
            'filename' => $filename,
            'mime' => $mime,
            'bytes' => strlen($bytes),
            'format' => $format,
            'now' => $now,
        ]);

        return [
            'id' => $id,
            'filename' => $filename,
            'mime' => $mime,
            'format' => $format,
            'bytes' => strlen($bytes),
            'url' => '/api/assets/' . $id,
        ];
    }

    /** @return array<string, mixed>|null */
    public function find(string $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM assets WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }
        $safe = preg_replace('/[^A-Za-z0-9._-]/', '-', (string) $row['id']) ?? (string) $row['id'];
        $path = $this->directory . '/' . $safe . '.' . $row['format'];
        if (!is_file($path)) {
            return null;
        }

        return [
            'id' => (string) $row['id'],
            'filename' => (string) $row['filename'],
            'mime' => (string) $row['mime'],
            'format' => (string) $row['format'],
            'bytes' => (int) $row['bytes'],
            'path' => $path,
            'createdAt' => (string) $row['created_at'],
        ];
    }

    /** @return array<int, array<string, mixed>> */
    public function forDocument(string $documentId): array
    {
        $stmt = $this->pdo->prepare('SELECT id, filename, mime, format, bytes, created_at FROM assets WHERE document_id = :doc ORDER BY created_at DESC');
        $stmt->execute(['doc' => $documentId]);

        return array_map(static fn (array $row): array => [
            'id' => (string) $row['id'],
            'filename' => (string) $row['filename'],
            'mime' => (string) $row['mime'],
            'format' => (string) $row['format'],
            'bytes' => (int) $row['bytes'],
            'createdAt' => (string) $row['created_at'],
            'url' => '/api/assets/' . $row['id'],
        ], $stmt->fetchAll());
    }
}
