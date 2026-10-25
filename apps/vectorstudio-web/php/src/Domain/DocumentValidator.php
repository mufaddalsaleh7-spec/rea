<?php

declare(strict_types=1);

namespace VectorStudio\Domain;

use VectorStudio\Http\HttpError;

/**
 * Validates and normalises a VectorStudio document.
 *
 * The browser is the editor, but the server is the boundary of record: every
 * stored document must have artboards, layers and well-formed nodes, and the
 * size/topology budgets below stop a malformed client from exhausting the
 * store. Normalisation fills optional defaults so stored payloads stay
 * canonical, which keeps the revision history comparable.
 */
final class DocumentValidator
{
    public const MAX_NODES = 20_000;
    public const MAX_DEPTH = 12;

    private int $nodes = 0;

    /** @return array{document: array<string, mixed>, meta: array<string, mixed>} */
    public function validate(mixed $input, ?string $fallbackName = null): array
    {
        if (!is_array($input)) {
            throw HttpError::badRequest('Document must be a JSON object');
        }
        foreach (['artboards', 'layers'] as $key) {
            if (!isset($input[$key]) || !is_array($input[$key])) {
                throw HttpError::badRequest(sprintf('Document is missing the "%s" collection', $key), ['field' => $key]);
            }
        }
        if ($input['artboards'] === []) {
            throw HttpError::badRequest('A document needs at least one artboard');
        }

        $artboards = [];
        foreach (array_values($input['artboards']) as $index => $artboard) {
            if (!is_array($artboard)) {
                throw HttpError::badRequest(sprintf('Artboard %d is not an object', $index + 1));
            }
            $w = self::number($artboard['w'] ?? null, 1.0);
            $h = self::number($artboard['h'] ?? null, 1.0);
            $artboards[] = [
                'id' => self::id($artboard['id'] ?? null, 'ab'),
                'name' => self::text($artboard['name'] ?? null, 'Artboard ' . ($index + 1), 120),
                'x' => self::number($artboard['x'] ?? 0, 0.0),
                'y' => self::number($artboard['y'] ?? 0, 0.0),
                'w' => max(1.0, $w),
                'h' => max(1.0, $h),
            ];
        }

        $activeArtboardId = (string) ($input['activeArtboardId'] ?? $artboards[0]['id']);
        if (!in_array($activeArtboardId, array_column($artboards, 'id'), true)) {
            $activeArtboardId = $artboards[0]['id'];
        }

        $layers = [];
        foreach (array_values($input['layers']) as $index => $layer) {
            if (!is_array($layer)) {
                throw HttpError::badRequest(sprintf('Layer %d is not an object', $index + 1));
            }
            $children = is_array($layer['children'] ?? null) ? $layer['children'] : [];
            $layers[] = [
                'id' => self::id($layer['id'] ?? null, 'ly'),
                'name' => self::text($layer['name'] ?? null, 'Layer ' . ($index + 1), 120),
                'visible' => (bool) ($layer['visible'] ?? true),
                'locked' => (bool) ($layer['locked'] ?? false),
                'opacity' => self::percent($layer['opacity'] ?? 1),
                'color' => self::color($layer['color'] ?? null, '#5a8ec9'),
                'children' => $this->nodes($children, 0),
            ];
        }

        $guides = [];
        foreach ((is_array($input['guides'] ?? null) ? $input['guides'] : []) as $guide) {
            if (!is_array($guide)) {
                continue;
            }
            $axis = ($guide['axis'] ?? 'h') === 'v' ? 'v' : 'h';
            $guides[] = [
                'id' => self::id($guide['id'] ?? null, 'gd'),
                'axis' => $axis,
                'pos' => self::number($guide['pos'] ?? 0, 0.0),
                'visible' => (bool) ($guide['visible'] ?? true),
            ];
        }

        $name = self::text($input['name'] ?? null, $fallbackName ?? 'Untitled', 120);
        $document = [
            'format' => 'vectorstudio/1',
            'name' => $name,
            'units' => in_array($input['units'] ?? 'px', ['px', 'pt', 'mm', 'in'], true) ? (string) $input['units'] : 'px',
            'colorMode' => in_array($input['colorMode'] ?? 'RGB', ['RGB', 'CMYK'], true) ? (string) $input['colorMode'] : 'RGB',
            'artboards' => $artboards,
            'activeArtboardId' => $activeArtboardId,
            'layers' => $layers,
            'guides' => $guides,
        ];

        $active = null;
        foreach ($artboards as $artboard) {
            if ($artboard['id'] === $activeArtboardId) {
                $active = $artboard;
            }
        }

        return [
            'document' => $document,
            'meta' => [
                'name' => $name,
                'width' => $active['w'] ?? 0.0,
                'height' => $active['h'] ?? 0.0,
                'artboards' => count($artboards),
                'objects' => $this->nodes,
            ],
        ];
    }

    /** @param array<int, mixed> $list */
    private function nodes(array $list, int $depth): array
    {
        if ($depth > self::MAX_DEPTH) {
            throw HttpError::badRequest('Document nesting is too deep', ['depth' => $depth]);
        }
        $out = [];
        foreach ($list as $node) {
            if (!is_array($node)) {
                continue;
            }
            if (++$this->nodes > self::MAX_NODES) {
                throw HttpError::badRequest('Document has too many objects', ['limit' => self::MAX_NODES]);
            }
            $type = in_array($node['type'] ?? 'path', ['path', 'text', 'group'], true) ? (string) $node['type'] : 'path';
            $base = [
                'id' => self::id($node['id'] ?? null, 'n'),
                'type' => $type,
                'kind' => self::text($node['kind'] ?? null, $type, 40),
                'name' => self::text($node['name'] ?? null, ucfirst($type), 120),
                'fill' => self::paint($node['fill'] ?? null),
                'stroke' => self::stroke($node['stroke'] ?? null),
                'opacity' => self::percent($node['opacity'] ?? 1),
                'visible' => (bool) ($node['visible'] ?? true),
                'locked' => (bool) ($node['locked'] ?? false),
                'blendMode' => self::text($node['blendMode'] ?? null, 'source-over', 40),
                'fillRule' => ($node['fillRule'] ?? 'nonzero') === 'evenodd' ? 'evenodd' : 'nonzero',
            ];
            if ($type === 'group') {
                $children = is_array($node['children'] ?? null) ? $node['children'] : [];
                $base['children'] = $this->nodes($children, $depth + 1);
                $out[] = $base;
                continue;
            }
            if ($type === 'text') {
                $base['text'] = self::text($node['text'] ?? null, 'Type', 2000);
                $base['x'] = self::number($node['x'] ?? 0, 0.0);
                $base['y'] = self::number($node['y'] ?? 0, 0.0);
                $base['fontFamily'] = self::text($node['fontFamily'] ?? null, 'Helvetica Neue, Helvetica, Arial, sans-serif', 200);
                $base['fontSize'] = self::number($node['fontSize'] ?? 36, 36.0);
                $base['fontWeight'] = (int) self::number($node['fontWeight'] ?? 400, 400.0);
                $base['fontStyle'] = ($node['fontStyle'] ?? 'normal') === 'italic' ? 'italic' : 'normal';
                $base['letterSpacing'] = self::number($node['letterSpacing'] ?? 0, 0.0);
                $base['lineHeight'] = isset($node['lineHeight']) ? self::number($node['lineHeight'], 0.0) : null;
                $base['align'] = in_array($node['align'] ?? 'left', ['left', 'center', 'right', 'justify'], true)
                    ? (string) $node['align'] : 'left';
                $out[] = $base;
                continue;
            }
            $base['subpaths'] = $this->subpaths($node['subpaths'] ?? null);
            $out[] = $base;
        }

        return $out;
    }

    /** @return array<int, array{nodes: array<int, array<string, float>>, closed: bool}> */
    private function subpaths(mixed $input): array
    {
        if (!is_array($input)) {
            throw HttpError::badRequest('Path is missing its subpaths');
        }
        $out = [];
        foreach ($input as $subpath) {
            if (!is_array($subpath)) {
                continue;
            }
            $nodes = [];
            foreach ((is_array($subpath['nodes'] ?? null) ? $subpath['nodes'] : []) as $point) {
                if (!is_array($point)) {
                    continue;
                }
                $nodes[] = [
                    'x' => round(self::number($point['x'] ?? 0, 0.0), 3),
                    'y' => round(self::number($point['y'] ?? 0, 0.0), 3),
                    'ix' => round(self::optionalNumber($point['ix'] ?? null), 3),
                    'iy' => round(self::optionalNumber($point['iy'] ?? null), 3),
                    'ox' => round(self::optionalNumber($point['ox'] ?? null), 3),
                    'oy' => round(self::optionalNumber($point['oy'] ?? null), 3),
                ];
            }
            if ($nodes === []) {
                continue;
            }
            $out[] = ['nodes' => $nodes, 'closed' => (bool) ($subpath['closed'] ?? false)];
        }
        if ($out === []) {
            throw HttpError::badRequest('A path needs at least one node');
        }

        return $out;
    }

    /** @return array<string, mixed>|null */
    private function paint(mixed $paint): ?array
    {
        if (!is_array($paint)) {
            return null;
        }
        $type = $paint['type'] ?? 'solid';
        if ($type === 'gradient' || $type === 'radial') {
            $stops = [];
            foreach ((is_array($paint['stops'] ?? null) ? $paint['stops'] : []) as $stop) {
                if (!is_array($stop)) {
                    continue;
                }
                $stops[] = [
                    'offset' => max(0.0, min(1.0, self::number($stop['offset'] ?? 0, 0.0))),
                    'color' => self::color($stop['color'] ?? null, '#000000'),
                ];
            }
            if (count($stops) < 2) {
                $stops = [
                    ['offset' => 0.0, 'color' => '#ffffff'],
                    ['offset' => 1.0, 'color' => '#000000'],
                ];
            }

            return ['type' => $type, 'stops' => $stops, 'angle' => self::number($paint['angle'] ?? 90, 90.0)];
        }
        if (!isset($paint['color'])) {
            return null;
        }

        return ['type' => 'solid', 'color' => self::color($paint['color'], '#000000')];
    }

    /** @return array<string, mixed>|null */
    private function stroke(mixed $stroke): ?array
    {
        if (!is_array($stroke)) {
            return null;
        }
        $width = self::number($stroke['width'] ?? 1, 1.0);
        if ($width <= 0) {
            return null;
        }
        $dash = [];
        foreach ((is_array($stroke['dash'] ?? null) ? $stroke['dash'] : []) as $value) {
            $dash[] = max(0.0, self::number($value, 0.0));
        }

        return [
            'color' => self::color($stroke['color'] ?? null, '#111111'),
            'width' => $width,
            'cap' => in_array($stroke['cap'] ?? 'butt', ['butt', 'round', 'square'], true) ? (string) $stroke['cap'] : 'butt',
            'join' => in_array($stroke['join'] ?? 'miter', ['miter', 'round', 'bevel'], true) ? (string) $stroke['join'] : 'miter',
            'dash' => $dash,
            'opacity' => self::percent($stroke['opacity'] ?? 1),
        ];
    }

    private static function id(mixed $value, string $prefix): string
    {
        $id = is_string($value) ? preg_replace('/[^A-Za-z0-9_.\-]/', '', $value) : '';
        if (!is_string($id) || $id === '') {
            $id = $prefix . '_' . bin2hex(random_bytes(6));
        }

        return substr($id, 0, 64);
    }

    private static function text(mixed $value, string $default, int $max): string
    {
        if (!is_string($value)) {
            return $default;
        }
        $trimmed = trim($value);

        return $trimmed === '' ? $default : mb_substr($trimmed, 0, $max);
    }

    private static function number(mixed $value, float $default): float
    {
        $number = is_numeric($value) ? (float) $value : $default;

        return is_finite($number) ? $number : $default;
    }

    private static function optionalNumber(mixed $value): float
    {
        return is_numeric($value) && is_finite((float) $value) ? (float) $value : 0.0;
    }

    private static function percent(mixed $value): float
    {
        return max(0.0, min(1.0, self::number($value, 1.0)));
    }

    private static function color(mixed $value, string $default): string
    {
        if (!is_string($value)) {
            return $default;
        }
        $color = strtolower(trim($value));
        if (preg_match('/^#[0-9a-f]{3}$/', $color) === 1) {
            return '#' . $color[1] . $color[1] . $color[2] . $color[2] . $color[3] . $color[3];
        }
        if (preg_match('/^#[0-9a-f]{6}$/', $color) === 1) {
            return $color;
        }

        return $default;
    }
}
