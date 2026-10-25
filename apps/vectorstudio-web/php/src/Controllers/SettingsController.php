<?php

declare(strict_types=1);

namespace VectorStudio\Controllers;

use VectorStudio\Http\HttpError;
use VectorStudio\Http\Request;
use VectorStudio\Http\Response;
use VectorStudio\Storage\SettingsRepository;

/** Workspace preferences: theme, dock layout, visible panels, workspace preset. */
final class SettingsController
{
    public function __construct(private readonly SettingsRepository $settings)
    {
    }

    public function show(Request $request): Response
    {
        return Response::json(['settings' => (object) $this->settings->all()]);
    }

    public function update(Request $request): Response
    {
        $body = $request->json();
        $values = isset($body['settings']) && is_array($body['settings']) ? $body['settings'] : $body;
        if (!is_array($values) || $values === []) {
            throw HttpError::badRequest('Send at least one setting');
        }
        if (count($values) > 60) {
            throw HttpError::badRequest('Too many settings in one request');
        }

        return Response::json(['settings' => (object) $this->settings->put($values, gmdate('c'))]);
    }
}
