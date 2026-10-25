<?php

declare(strict_types=1);

namespace VectorStudio\Domain;

/**
 * Server-side SVG writer.
 *
 * The editor exports SVG in the browser for instant downloads; the server
 * writer exists so stored documents can be re-exported without a browser and so
 * exports can be shared as stable URLs. It walks the same document model and
 * emits paths, type, gradients and per-layer groups.
 */
final class SvgWriter
{
    /** @var list<string> */
    private array $defs = [];

    private int $gradientIndex = 0;

    /** @param array<string, mixed> $document */
    public function write(array $document, ?string $artboardId = null): string
    {
        $artboard = $this->activeArtboard($document, $artboardId);
        $layers = '';
        foreach ($document['layers'] as $layer) {
            if (($layer['visible'] ?? true) === false) {
                continue;
            }
            $inner = '';
            foreach ($layer['children'] as $node) {
                $inner .= $this->node($node, 2);
            }
            $layers .= sprintf(
                "  <g id=\"%s\" data-layer=\"%s\">\n%s\n  </g>\n",
                $this->attr((string) $layer['id']),
                $this->attr((string) $layer['name']),
                rtrim($inner, "\n"),
            );
        }
        $defs = $this->defs === [] ? '' : "  <defs>\n" . implode("\n", $this->defs) . "\n  </defs>\n";

        return sprintf(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
            . "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"%s\" height=\"%s\" viewBox=\"%s %s %s %s\">\n"
            . "  <title>%s</title>\n"
            . "  <desc>VectorStudio server export · React + PHP edition</desc>\n"
            . "%s%s</svg>\n",
            $this->num($artboard['w']),
            $this->num($artboard['h']),
            $this->num($artboard['x']),
            $this->num($artboard['y']),
            $this->num($artboard['w']),
            $this->num($artboard['h']),
            $this->attr((string) $document['name']),
            $defs,
            $layers,
        );
    }

    /** @param array<string, mixed> $document */
    private function activeArtboard(array $document, ?string $artboardId): array
    {
        $wanted = $artboardId ?? (string) ($document['activeArtboardId'] ?? '');
        foreach ($document['artboards'] as $artboard) {
            if ((string) $artboard['id'] === $wanted) {
                return $artboard;
            }
        }

        return $document['artboards'][0];
    }

    /** @param array<string, mixed> $node */
    private function node(array $node, int $depth): string
    {
        if (($node['visible'] ?? true) === false) {
            return '';
        }
        $pad = str_repeat('  ', $depth);
        if (($node['type'] ?? 'path') === 'group') {
            $inner = '';
            foreach ($node['children'] ?? [] as $child) {
                $inner .= $this->node($child, $depth + 1);
            }

            return sprintf(
                "%s<g id=\"%s\" data-name=\"%s\">\n%s%s</g>\n",
                $pad,
                $this->attr((string) $node['id']),
                $this->attr((string) $node['name']),
                rtrim($inner, "\n"),
                "\n" . $pad,
            );
        }
        if (($node['type'] ?? 'path') === 'text') {
            return $this->textNode($node, $pad);
        }

        return sprintf(
            "%s<path id=\"%s\" data-name=\"%s\" d=\"%s\" %s/>\n",
            $pad,
            $this->attr((string) $node['id']),
            $this->attr((string) $node['name']),
            $this->pathData($node['subpaths'] ?? []),
            $this->paintAttributes($node),
        );
    }

    /** @param array<string, mixed> $node */
    private function textNode(array $node, string $pad): string
    {
        $fontSize = (float) ($node['fontSize'] ?? 36);
        $lineHeight = isset($node['lineHeight']) && $node['lineHeight'] ? (float) $node['lineHeight'] : $fontSize * 1.2;
        $lines = preg_split('/\r\n|\r|\n/', (string) ($node['text'] ?? '')) ?: [''];
        $anchor = match ($node['align'] ?? 'left') {
            'center' => 'middle',
            'right' => 'end',
            default => 'start',
        };
        $fill = is_array($node['fill'] ?? null) && isset($node['fill']['color']) ? (string) $node['fill']['color'] : '#000000';
        $spans = '';
        foreach ($lines as $index => $line) {
            $spans .= sprintf(
                '<tspan x="%s" y="%s">%s</tspan>',
                $this->num((float) $node['x']),
                $this->num((float) $node['y'] + $index * $lineHeight + $fontSize * 0.82),
                $this->attr($line === '' ? ' ' : $line),
            );
        }

        return sprintf(
            "%s<text id=\"%s\" data-name=\"%s\" font-family=\"%s\" font-size=\"%s\" font-weight=\"%d\"%s letter-spacing=\"%s\" fill=\"%s\" text-anchor=\"%s\">%s</text>\n",
            $pad,
            $this->attr((string) $node['id']),
            $this->attr((string) $node['name']),
            $this->attr((string) ($node['fontFamily'] ?? 'sans-serif')),
            $this->num($fontSize),
            (int) ($node['fontWeight'] ?? 400),
            ($node['fontStyle'] ?? 'normal') === 'italic' ? ' font-style="italic"' : '',
            $this->num((float) ($node['letterSpacing'] ?? 0)),
            $this->attr($fill),
            $anchor,
            $spans,
        );
    }

    /** @param array<int, array<nodes: array<int, array<string, float>>, closed: bool>> $subpaths */
    private function pathData(array $subpaths): string
    {
        $out = '';
        foreach ($subpaths as $subpath) {
            $nodes = $subpath['nodes'] ?? [];
            if ($nodes === []) {
                continue;
            }
            $out .= 'M ' . $this->num($nodes[0]['x']) . ' ' . $this->num($nodes[0]['y']);
            $count = count($nodes);
            for ($i = 0; $i < $count; $i++) {
                $current = $nodes[$i];
                $next = $nodes[($i + 1) % $count];
                $isLast = $i === $count - 1;
                if ($isLast && empty($subpath['closed'])) {
                    break;
                }
                $hasCurve = ($current['ox'] ?? 0) !== 0.0 || ($current['oy'] ?? 0) !== 0.0
                    || ($next['ix'] ?? 0) !== 0.0 || ($next['iy'] ?? 0) !== 0.0;
                if ($hasCurve) {
                    $out .= sprintf(
                        ' C %s %s %s %s %s %s',
                        $this->num((float) $current['x'] + (float) ($current['ox'] ?? 0)),
                        $this->num((float) $current['y'] + (float) ($current['oy'] ?? 0)),
                        $this->num((float) $next['x'] + (float) ($next['ix'] ?? 0)),
                        $this->num((float) $next['y'] + (float) ($next['iy'] ?? 0)),
                        $this->num((float) $next['x']),
                        $this->num((float) $next['y']),
                    );
                } else {
                    $out .= ' L ' . $this->num((float) $next['x']) . ' ' . $this->num((float) $next['y']);
                }
            }
            if (!empty($subpath['closed'])) {
                $out .= ' Z';
            }
        }

        return trim($out);
    }

    /** @param array<string, mixed> $node */
    private function paintAttributes(array $node): string
    {
        $attrs = [];
        $fill = $node['fill'] ?? null;
        if (is_array($fill) && ($fill['type'] ?? 'solid') !== 'solid') {
            $id = 'grad-' . (++$this->gradientIndex);
            $stops = '';
            foreach ($fill['stops'] ?? [] as $stop) {
                $stops .= sprintf(
                    '<stop offset="%s" stop-color="%s"/>',
                    $this->num((float) $stop['offset']),
                    $this->attr((string) $stop['color']),
                );
            }
            if (($fill['type'] ?? '') === 'radial') {
                $this->defs[] = sprintf(
                    '    <radialGradient id="%s">%s</radialGradient>',
                    $id,
                    $stops,
                );
            } else {
                $this->defs[] = sprintf(
                    '    <linearGradient id="%s" x1="0%%" y1="0%%" x2="100%%" y2="0%%" gradientTransform="rotate(%s 0.5 0.5)">%s</linearGradient>',
                    $id,
                    $this->num((float) ($fill['angle'] ?? 90) - 90),
                    $stops,
                );
            }
            $attrs[] = sprintf('fill="url(#%s)"', $id);
        } elseif (is_array($fill) && isset($fill['color'])) {
            $attrs[] = 'fill="' . $this->attr((string) $fill['color']) . '"';
        } else {
            $attrs[] = 'fill="none"';
        }

        $stroke = $node['stroke'] ?? null;
        if (is_array($stroke) && (float) ($stroke['width'] ?? 0) > 0) {
            $attrs[] = 'stroke="' . $this->attr((string) $stroke['color']) . '"';
            $attrs[] = 'stroke-width="' . $this->num((float) $stroke['width']) . '"';
            if (($stroke['cap'] ?? 'butt') !== 'butt') {
                $attrs[] = 'stroke-linecap="' . $this->attr((string) $stroke['cap']) . '"';
            }
            if (($stroke['join'] ?? 'miter') !== 'miter') {
                $attrs[] = 'stroke-linejoin="' . $this->attr((string) $stroke['join']) . '"';
            }
            if (!empty($stroke['dash'])) {
                $attrs[] = 'stroke-dasharray="' . implode(' ', array_map(
                    fn ($value): string => $this->num((float) $value),
                    $stroke['dash'],
                )) . '"';
            }
        }
        if (isset($node['opacity']) && (float) $node['opacity'] < 1.0) {
            $attrs[] = 'opacity="' . $this->num((float) $node['opacity']) . '"';
        }
        if (($node['blendMode'] ?? 'source-over') !== 'source-over') {
            $attrs[] = 'style="mix-blend-mode:' . $this->attr((string) $node['blendMode']) . '"';
        }
        if (($node['fillRule'] ?? 'nonzero') === 'evenodd') {
            $attrs[] = 'fill-rule="evenodd"';
        }

        return implode(' ', $attrs);
    }

    private function num(float $value): string
    {
        $rounded = round($value, 3);
        $text = number_format($rounded, 3, '.', '');
        $text = rtrim(rtrim($text, '0'), '.');

        return $text === '' || $text === '-' ? '0' : $text;
    }

    private function attr(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_XML1, 'UTF-8');
    }
}
