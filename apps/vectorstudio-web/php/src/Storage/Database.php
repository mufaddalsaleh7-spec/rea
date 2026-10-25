<?php

declare(strict_types=1);

namespace VectorStudio\Storage;

use PDO;

/**
 * SQLite connection with the schema applied idempotently.
 *
 * Documents are stored as validated JSON payloads plus denormalised summary
 * columns (name, size, revision) so listing never has to parse artwork.
 */
final class Database
{
    public static function connect(string $path): PDO
    {
        $dsn = $path === ':memory:' ? 'sqlite::memory:' : 'sqlite:' . $path;
        $pdo = new PDO($dsn, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $pdo->exec('PRAGMA journal_mode = WAL');
        $pdo->exec('PRAGMA foreign_keys = ON');
        self::migrate($pdo);

        return $pdo;
    }

    private static function migrate(PDO $pdo): void
    {
        $pdo->exec('CREATE TABLE IF NOT EXISTS documents (
            id            TEXT PRIMARY KEY,
            name          TEXT NOT NULL,
            revision      INTEGER NOT NULL DEFAULT 1,
            width         REAL NOT NULL DEFAULT 0,
            height        REAL NOT NULL DEFAULT 0,
            artboards     INTEGER NOT NULL DEFAULT 1,
            objects       INTEGER NOT NULL DEFAULT 0,
            bytes         INTEGER NOT NULL DEFAULT 0,
            starred       INTEGER NOT NULL DEFAULT 0,
            payload       TEXT NOT NULL,
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        )');

        $pdo->exec('CREATE TABLE IF NOT EXISTS revisions (
            document_id   TEXT NOT NULL,
            revision      INTEGER NOT NULL,
            name          TEXT NOT NULL,
            payload       TEXT NOT NULL,
            created_at    TEXT NOT NULL,
            PRIMARY KEY (document_id, revision),
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        )');

        $pdo->exec('CREATE TABLE IF NOT EXISTS assets (
            id            TEXT PRIMARY KEY,
            document_id   TEXT,
            filename      TEXT NOT NULL,
            mime          TEXT NOT NULL,
            bytes         INTEGER NOT NULL,
            format        TEXT NOT NULL,
            created_at    TEXT NOT NULL
        )');

        $pdo->exec('CREATE TABLE IF NOT EXISTS settings (
            key           TEXT PRIMARY KEY,
            value         TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        )');

        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at DESC)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_revisions_document ON revisions(document_id, revision DESC)');
    }
}
