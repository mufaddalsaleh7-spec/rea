<?php

declare(strict_types=1);

namespace VectorStudio\Controllers;

use VectorStudio\Http\Request;
use VectorStudio\Http\Response;
use VectorStudio\Storage\DocumentRepository;
use VectorStudio\Support\Config;

/** Liveness probe used by the SPA to decide between cloud and local storage. */
final class HealthController
{
    public function __construct(
        private readonly Config $config,
        private readonly DocumentRepository $documents,
    ) {
    }

    public function show(Request $request): Response
    {
        $stats = $this->documents->stats();

        return Response::json([
            'ok' => true,
            'service' => 'vectorstudio-api',
            'version' => '1.0.0',
            'php' => PHP_VERSION,
            'time' => gmdate('c'),
            'storage' => [
                'driver' => 'sqlite',
                'writable' => is_writable($this->config->storageDir),
                'documents' => $stats['documents'],
                'bytes' => $stats['bytes'],
            ],
            'limits' => [
                'documentBytes' => $this->config->maxDocumentBytes,
                'assetBytes' => $this->config->maxAssetBytes,
                'revisions' => $this->config->maxRevisions,
            ],
            'export' => ['svg', 'json'],
        ]);
    }
}
