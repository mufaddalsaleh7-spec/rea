<?php

declare(strict_types=1);

namespace VectorStudio\Controllers;

use VectorStudio\Http\HttpError;
use VectorStudio\Http\Request;
use VectorStudio\Http\Response;
use VectorStudio\Storage\AssetRepository;
use VectorStudio\Storage\DocumentRepository;

/**
 * Stores binary exports produced by the editor (canvas PNG renders, SVG
 * snapshots) so they can be linked and downloaded again later.
 */
final class AssetsController
{
    private const ALLOWED = [
        'png' => 'image/png',
        'svg' => 'image/svg+xml',
        'json' => 'application/json',
    ];

    public function __construct(
        private readonly AssetRepository $assets,
        private readonly DocumentRepository $documents,
    ) {
    }

    public function create(Request $request): Response
    {
        $documentId = $request->param('id');
        $body = $request->json();
        $format = strtolower((string) ($body['format'] ?? 'png'));
        if (!isset(self::ALLOWED[$format])) {
            throw HttpError::badRequest('Unsupported asset format', ['supported' => array_keys(self::ALLOWED)]);
        }
        $data = $body['data'] ?? null;
        if (!is_string($data) || $data === '') {
            throw HttpError::badRequest('Asset payload "data" (base64) is required');
        }
        $base64 = preg_replace('#^data:[^;]+;base64,#', '', $data);
        $bytes = base64_decode((string) $base64, true);
        if ($bytes === false || $bytes === '') {
            throw HttpError::badRequest('Asset payload is not valid base64');
        }
        if ($documentId !== null && $this->documents->find($documentId) === null) {
            throw HttpError::notFound('Document');
        }
        $id = 'as_' . bin2hex(random_bytes(8));
        $filename = (string) ($body['filename'] ?? ('export.' . $format));

        $stored = $this->assets->store(
            $id,
            $documentId,
            mb_substr(preg_replace('/[^\w.\-]+/', '-', $filename) ?: 'export', 0, 120),
            self::ALLOWED[$format],
            $format,
            $bytes,
            gmdate('c'),
        );

        return Response::json($stored, 201);
    }

    public function show(Request $request): Response
    {
        $asset = $this->assets->find((string) $request->param('id'));
        if ($asset === null) {
            throw HttpError::notFound('Asset');
        }

        return new Response(200, (string) file_get_contents($asset['path']), [
            'content-type' => $asset['mime'],
            'content-disposition' => 'inline; filename="' . addslashes($asset['filename']) . '"',
            'cache-control' => 'private, max-age=600',
        ]);
    }

    public function index(Request $request): Response
    {
        return Response::json(['assets' => $this->assets->forDocument((string) $request->param('id'))]);
    }
}
