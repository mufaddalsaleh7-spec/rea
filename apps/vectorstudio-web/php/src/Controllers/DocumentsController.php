<?php

declare(strict_types=1);

namespace VectorStudio\Controllers;

use VectorStudio\Domain\DocumentValidator;
use VectorStudio\Domain\SvgWriter;
use VectorStudio\Http\HttpError;
use VectorStudio\Http\Request;
use VectorStudio\Http\Response;
use VectorStudio\Storage\AssetRepository;
use VectorStudio\Storage\DocumentRepository;
use VectorStudio\Support\Config;

/** REST resource for stored artwork plus its revisions and exports. */
final class DocumentsController
{
    public function __construct(
        private readonly DocumentRepository $documents,
        private readonly AssetRepository $assets,
        private readonly Config $config,
        private readonly DocumentValidator $validator = new DocumentValidator(),
    ) {
    }

    public function index(Request $request): Response
    {
        $limit = $request->intQuery('limit', 50, 1, 200);
        $search = trim((string) $request->queryParam('q', ''));

        return Response::json([
            'documents' => $this->documents->list($limit, $search),
            'stats' => $this->documents->stats(),
        ]);
    }

    public function show(Request $request): Response
    {
        $id = (string) $request->param('id');
        $document = $this->documents->find($id, true);
        if ($document === null) {
            throw HttpError::notFound('Document');
        }

        return Response::json($document + ['assets' => $this->assets->forDocument($id)]);
    }

    public function create(Request $request): Response
    {
        $body = $request->json();
        $raw = $body['document'] ?? $body;
        $name = isset($body['name']) && is_string($body['name']) ? $body['name'] : null;
        $validated = $this->validator->validate($raw, $name);
        $this->assertSize($validated['document']);

        $id = 'doc_' . bin2hex(random_bytes(8));
        $now = gmdate('c');
        $created = $this->documents->create($validated['document'], $validated['meta'], $id, $now);

        return Response::json($created, 201);
    }

    public function update(Request $request): Response
    {
        $id = (string) $request->param('id');
        $body = $request->json();
        $raw = $body['document'] ?? null;
        $meta = null;
        if ($raw !== null) {
            $name = isset($body['name']) && is_string($body['name']) ? $body['name'] : null;
            $validated = $this->validator->validate($raw, $name);
            $this->assertSize($validated['document']);
            $raw = $validated['document'];
            $meta = $validated['meta'];
        } elseif (isset($body['name']) || isset($body['starred'])) {
            $meta = array_filter([
                'name' => isset($body['name']) && is_string($body['name']) ? mb_substr(trim($body['name']), 0, 120) : null,
                'starred' => isset($body['starred']) ? (int) (bool) $body['starred'] : null,
            ], static fn ($value): bool => $value !== null);
        }
        if ($raw === null && $meta === null) {
            throw HttpError::badRequest('Nothing to update: send a document or metadata');
        }
        $baseRevision = isset($body['baseRevision']) && is_numeric($body['baseRevision'])
            ? (int) $body['baseRevision']
            : null;

        $updated = $this->documents->update($id, $raw, $meta, $baseRevision, gmdate('c'));

        return Response::json($updated);
    }

    public function delete(Request $request): Response
    {
        $id = (string) $request->param('id');
        if (!$this->documents->delete($id)) {
            throw HttpError::notFound('Document');
        }

        return Response::empty();
    }

    public function revisions(Request $request): Response
    {
        $id = (string) $request->param('id');
        if ($this->documents->find($id) === null) {
            throw HttpError::notFound('Document');
        }

        return Response::json(['revisions' => $this->documents->revisions($id)]);
    }

    public function restore(Request $request): Response
    {
        $id = (string) $request->param('id');
        $fromPath = $request->param('revision');
        $revision = $fromPath !== null ? (int) $fromPath : (int) ($request->json()['revision'] ?? 0);
        $payload = $this->documents->revisionPayload($id, $revision);
        if ($payload === null) {
            throw HttpError::notFound('Revision');
        }
        $validated = $this->validator->validate($payload['document'], $payload['name']);
        $updated = $this->documents->update(
            $id,
            $validated['document'],
            $validated['meta'],
            null,
            gmdate('c'),
            'restore r' . $revision,
        );

        return Response::json($updated);
    }

    public function export(Request $request): Response
    {
        $id = (string) $request->param('id');
        $document = $this->documents->find($id, true);
        if ($document === null) {
            throw HttpError::notFound('Document');
        }
        $format = strtolower((string) $request->queryParam('format', 'svg'));
        $slug = preg_replace('/[^a-z0-9]+/', '-', strtolower((string) $document['name'])) ?: 'artwork';
        $artboardId = $request->queryParam('artboard');

        if ($format === 'svg') {
            $svg = (new SvgWriter())->write($document['document'], $artboardId);

            return Response::download($svg, 'image/svg+xml; charset=utf-8', $slug . '.svg');
        }
        if ($format === 'json' || $format === 'vectorstudio') {
            $json = json_encode($document['document'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

            return Response::download((string) $json, 'application/json', $slug . '.vectorstudio');
        }
        throw HttpError::badRequest('Unsupported export format', ['format' => $format, 'supported' => ['svg', 'json']]);
    }

    /** @param array<string, mixed> $document */
    private function assertSize(array $document): void
    {
        $bytes = strlen((string) json_encode($document, JSON_UNESCAPED_SLASHES));
        if ($bytes > $this->config->maxDocumentBytes) {
            throw HttpError::tooLarge('Document exceeds the storage limit', [
                'bytes' => $bytes,
                'limit' => $this->config->maxDocumentBytes,
            ]);
        }
    }
}
