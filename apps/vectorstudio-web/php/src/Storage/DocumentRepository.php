<?php

declare(strict_types=1);

namespace VectorStudio\Storage;

use PDO;

/**
 * Document persistence with monotonic revisions.
 *
 * Every write stores the accepted payload as a revision, so the client can
 * browse history and restore a previous state. Updates are optimistic: a
 * caller may pass the revision it edited, and a stale revision is rejected
 * instead of silently overwriting newer artwork.
 */
final class DocumentRepository
{
    public function __construct(private readonly PDO $pdo, private readonly int $maxRevisions = 40)
    {
    }

    /** @return array<int, array<string, mixed>> */
    public function list(int $limit = 50, string $search = ''): array
    {
        $sql = 'SELECT id, name, revision, width, height, artboards, objects, bytes, starred, created_at, updated_at
                FROM documents';
        $params = [];
        if ($search !== '') {
            $sql .= ' WHERE name LIKE :q';
            $params['q'] = '%' . $search . '%';
        }
        $sql .= ' ORDER BY starred DESC, updated_at DESC LIMIT :limit';

        $stmt = $this->pdo->prepare($sql);
        foreach ($params as $key => $value) {
            $stmt->bindValue($key, $value, PDO::PARAM_STR);
        }
        $stmt->bindValue('limit', $limit, PDO::PARAM_INT);
        $stmt->execute();

        return array_map([self::class, 'summary'], $stmt->fetchAll());
    }

    /** @return array<string, mixed>|null */
    public function find(string $id, bool $withPayload = false): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM documents WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }
        $summary = self::summary($row);
        if ($withPayload) {
            $summary['document'] = json_decode((string) $row['payload'], true);
        }

        return $summary;
    }

    /**
     * @param array<string, mixed> $document
     * @param array<string, mixed> $meta
     * @return array<string, mixed>
     */
    public function create(array $document, array $meta, string $id, string $now): array
    {
        $payload = json_encode($document, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $stmt = $this->pdo->prepare('INSERT INTO documents
            (id, name, revision, width, height, artboards, objects, bytes, starred, payload, created_at, updated_at)
            VALUES (:id, :name, 1, :width, :height, :artboards, :objects, :bytes, 0, :payload, :now, :now)');
        $stmt->execute([
            'id' => $id,
            'name' => (string) $meta['name'],
            'width' => (float) $meta['width'],
            'height' => (float) $meta['height'],
            'artboards' => (int) $meta['artboards'],
            'objects' => (int) $meta['objects'],
            'bytes' => strlen((string) $payload),
            'payload' => $payload,
            'now' => $now,
        ]);
        $this->recordRevision($id, 1, (string) $meta['name'], (string) $payload, $now);

        return $this->find($id, true) ?? [];
    }

    /**
     * @param array<string, mixed>|null $document
     * @param array<string, mixed>|null $meta
     * @return array<string, mixed>
     */
    public function update(
        string $id,
        ?array $document,
        ?array $meta,
        ?int $baseRevision,
        string $now,
        string $label = 'save',
    ): array {
        $current = $this->find($id, true);
        if ($current === null) {
            throw new \VectorStudio\Http\HttpError(404, 'Document not found');
        }
        if ($baseRevision !== null && $baseRevision !== (int) $current['revision']) {
            throw new \VectorStudio\Http\HttpError(409, 'Document changed on the server', [
                'revision' => $current['revision'],
                'name' => $current['name'],
            ]);
        }
        $revision = ((int) $current['revision']) + 1;
        $name = (string) ($meta['name'] ?? $current['name']);
        $payload = $document === null
            ? json_encode($current['document'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
            : json_encode($document, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        $stmt = $this->pdo->prepare('UPDATE documents SET
            name = :name, revision = :revision, payload = :payload, bytes = :bytes,
            width = :width, height = :height, artboards = :artboards, objects = :objects,
            starred = :starred, updated_at = :now
            WHERE id = :id');
        $stmt->execute([
            'name' => $name,
            'revision' => $revision,
            'payload' => $payload,
            'bytes' => strlen((string) $payload),
            'width' => (float) ($meta['width'] ?? $current['width']),
            'height' => (float) ($meta['height'] ?? $current['height']),
            'artboards' => (int) ($meta['artboards'] ?? $current['artboards']),
            'objects' => (int) ($meta['objects'] ?? $current['objects']),
            'starred' => (int) ($meta['starred'] ?? $current['starred']),
            'now' => $now,
            'id' => $id,
        ]);
        $this->recordRevision($id, $revision, $name, (string) $payload, $now, $label);
        $this->pruneRevisions($id);

        return $this->find($id, true) ?? [];
    }

    public function delete(string $id): bool
    {
        $stmt = $this->pdo->prepare('DELETE FROM documents WHERE id = :id');
        $stmt->execute(['id' => $id]);

        return $stmt->rowCount() > 0;
    }

    /** @return array<int, array<string, mixed>> */
    public function revisions(string $id, int $limit = 25): array
    {
        $stmt = $this->pdo->prepare('SELECT revision, name, bytes, created_at AS createdAt
            FROM (
                SELECT revision, name, LENGTH(payload) AS bytes, created_at
                FROM revisions WHERE document_id = :id ORDER BY revision DESC LIMIT :limit
            ) ORDER BY revision DESC');
        $stmt->bindValue('id', $id, PDO::PARAM_STR);
        $stmt->bindValue('limit', $limit, PDO::PARAM_INT);
        $stmt->execute();

        return array_map(static fn (array $row): array => [
            'revision' => (int) $row['revision'],
            'name' => (string) $row['name'],
            'bytes' => (int) $row['bytes'],
            'createdAt' => (string) $row['createdAt'],
        ], $stmt->fetchAll());
    }

    /** @return array<string, mixed>|null */
    public function revisionPayload(string $id, int $revision): ?array
    {
        $stmt = $this->pdo->prepare('SELECT revision, name, payload, created_at FROM revisions WHERE document_id = :id AND revision = :rev');
        $stmt->execute(['id' => $id, 'rev' => $revision]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }

        return [
            'revision' => (int) $row['revision'],
            'name' => (string) $row['name'],
            'createdAt' => (string) $row['created_at'],
            'document' => json_decode((string) $row['payload'], true),
        ];
    }

    public function stats(): array
    {
        $row = $this->pdo->query('SELECT COUNT(*) AS documents, COALESCE(SUM(bytes), 0) AS bytes FROM documents')->fetch();

        return [
            'documents' => (int) ($row['documents'] ?? 0),
            'bytes' => (int) ($row['bytes'] ?? 0),
        ];
    }

    private function recordRevision(string $id, int $revision, string $name, string $payload, string $now, string $label = 'save'): void
    {
        $stmt = $this->pdo->prepare('INSERT OR REPLACE INTO revisions (document_id, revision, name, payload, created_at)
            VALUES (:id, :revision, :name, :payload, :now)');
        $stmt->execute([
            'id' => $id,
            'revision' => $revision,
            'name' => $name . ($label === 'save' ? '' : ' · ' . $label),
            'payload' => $payload,
            'now' => $now,
        ]);
    }

    private function pruneRevisions(string $id): void
    {
        $countStmt = $this->pdo->prepare('SELECT COUNT(*) FROM revisions WHERE document_id = :id');
        $countStmt->execute(['id' => $id]);
        $count = (int) $countStmt->fetchColumn();
        if ($count <= $this->maxRevisions) {
            return;
        }
        $excess = $count - $this->maxRevisions;
        $sql = 'DELETE FROM revisions WHERE document_id = :id AND revision IN (
            SELECT revision FROM revisions WHERE document_id = :id ORDER BY revision ASC LIMIT :excess
        )';
        $stmt = $this->pdo->prepare($sql);
        $stmt->bindValue('id', $id, PDO::PARAM_STR);
        $stmt->bindValue('excess', $excess, PDO::PARAM_INT);
        $stmt->execute();
    }

    /** @param array<string, mixed> $row */
    private static function summary(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'name' => (string) $row['name'],
            'revision' => (int) $row['revision'],
            'width' => (float) $row['width'],
            'height' => (float) $row['height'],
            'artboards' => (int) $row['artboards'],
            'objects' => (int) $row['objects'],
            'bytes' => (int) $row['bytes'],
            'starred' => (bool) $row['starred'],
            'createdAt' => (string) $row['created_at'],
            'updatedAt' => (string) $row['updated_at'],
        ];
    }
}
