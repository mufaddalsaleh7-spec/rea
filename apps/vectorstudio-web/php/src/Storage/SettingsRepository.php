<?php

declare(strict_types=1);

namespace VectorStudio\Storage;

use PDO;

/** Key/value store for workspace preferences (theme, dock layout, panels). */
final class SettingsRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /** @return array<string, mixed> */
    public function all(): array
    {
        $rows = $this->pdo->query('SELECT key, value FROM settings')->fetchAll();
        $out = [];
        foreach ($rows as $row) {
            $out[(string) $row['key']] = json_decode((string) $row['value'], true);
        }

        return $out;
    }

    /** @param array<string, mixed> $values */
    public function put(array $values, string $now): array
    {
        $stmt = $this->pdo->prepare('INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, :now)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at');
        foreach ($values as $key => $value) {
            if (!is_string($key) || $key === '' || strlen($key) > 80) {
                continue;
            }
            $stmt->execute([
                'key' => $key,
                'value' => json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                'now' => $now,
            ]);
        }

        return $this->all();
    }
}
