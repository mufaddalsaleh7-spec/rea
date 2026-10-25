<?php

declare(strict_types=1);

/**
 * Dependency-free API test suite.
 *
 *   php php/tests/run.php
 *
 * Every test drives the real router against an in-memory SQLite database, so
 * routing, validation, persistence, revisions and exports are exercised
 * together instead of separately.
 */

require dirname(__DIR__) . '/bootstrap.php';

use VectorStudio\App;
use VectorStudio\Http\Request;
use VectorStudio\Support\Config;

/** Write one line of test output on any SAPI (CLI, cgi, PHP-WASM). */
function out(string $text): void
{
    $stream = defined('STDOUT') ? STDOUT : fopen('php://output', 'wb');
    fwrite($stream, $text);
    if (!defined('STDOUT')) {
        fflush($stream);
    }
}

final class Harness
{
    public int $passed = 0;
    public int $failed = 0;
    /** @var list<string> */
    public array $failures = [];
    private string $tmp;

    public function __construct()
    {
        $this->tmp = sys_get_temp_dir() . '/vs-tests-' . bin2hex(random_bytes(4));
        mkdir($this->tmp . '/public', 0o777, true);
        file_put_contents($this->tmp . '/public/index.html', '<!doctype html><title>VectorStudio</title>');
    }

    public function tempDir(): string
    {
        return $this->tmp;
    }

    public function app(): App
    {
        return App::inMemory(new Config(
            storageDir: $this->tmp,
            publicDir: $this->tmp . '/public',
            staticRoots: [$this->tmp . '/public'],
            devCors: false,
        ));
    }

    public function check(string $name, bool $condition, string $detail = ''): void
    {
        if ($condition) {
            $this->passed++;
            out( "  \u{2713} {$name}\n");

            return;
        }
        $this->failed++;
        $this->failures[] = $name . ($detail !== '' ? ' — ' . $detail : '');
        out( "  \u{2717} {$name}" . ($detail !== '' ? " — {$detail}" : '') . "\n");
    }

    public function summarize(): int
    {
        out( sprintf("\n%d passed, %d failed\n", $this->passed, $this->failed));
        if ($this->failed > 0) {
            out( "failures:\n  - " . implode("\n  - ", $this->failures) . "\n");

            return 1;
        }

        return 0;
    }
}

/** @return array{0: int, 1: array<string, mixed>} */
function call(App $app, string $method, string $path, array|string|null $body = null): array
{
    $raw = $body === null ? '' : (is_string($body) ? $body : (string) json_encode($body));
    $query = [];
    if (str_contains($path, '?')) {
        [$path, $queryString] = explode('?', $path, 2);
        parse_str($queryString, $query);
    }
    $request = new Request(
        $method,
        $path,
        $query,
        is_array($body) ? $body : [],
        ['content-type' => 'application/json'],
        $raw,
    );
    $response = $app->handle($request);
    $decoded = json_decode($response->body, true);

    return [$response->status, is_array($decoded) ? $decoded : ['raw' => $response->body]];
}

function sampleDocument(string $name = 'API Test Artwork'): array
{
    return [
        'format' => 'vectorstudio/1',
        'name' => $name,
        'units' => 'px',
        'colorMode' => 'RGB',
        'artboards' => [['id' => 'ab1', 'name' => 'Artboard 1', 'x' => 0, 'y' => 0, 'w' => 640, 'h' => 480]],
        'activeArtboardId' => 'ab1',
        'layers' => [[
            'id' => 'ly1',
            'name' => 'Layer 1',
            'visible' => true,
            'locked' => false,
            'children' => [[
                'id' => 'rect1',
                'type' => 'path',
                'kind' => 'rect',
                'name' => 'Rectangle',
                'fill' => ['type' => 'solid', 'color' => '#3B6EA5'],
                'stroke' => ['color' => '#111111', 'width' => 2, 'cap' => 'butt', 'join' => 'miter', 'dash' => []],
                'subpaths' => [[
                    'nodes' => [
                        ['x' => 40, 'y' => 40, 'ix' => 0, 'iy' => 0, 'ox' => 0, 'oy' => 0],
                        ['x' => 240, 'y' => 40, 'ix' => 0, 'iy' => 0, 'ox' => 0, 'oy' => 0],
                        ['x' => 240, 'y' => 200, 'ix' => 0, 'iy' => 0, 'ox' => 0, 'oy' => 0],
                        ['x' => 40, 'y' => 200, 'ix' => 0, 'iy' => 0, 'ox' => 0, 'oy' => 0],
                    ],
                    'closed' => true,
                ]],
            ], [
                'id' => 'text1',
                'type' => 'text',
                'name' => 'Type',
                'text' => "VectorStudio\nReact + PHP",
                'x' => 48,
                'y' => 260,
                'fontFamily' => 'Georgia, serif',
                'fontSize' => 32,
                'align' => 'left',
                'fill' => ['type' => 'solid', 'color' => '#111111'],
            ]],
        ]],
        'guides' => [['id' => 'gd1', 'axis' => 'h', 'pos' => 100, 'visible' => true]],
    ];
}

$h = new Harness();
$app = $h->app();

out( "health\n");
[$status, $health] = call($app, 'GET', '/api/health');
$h->check('GET /api/health returns 200', $status === 200, (string) $status);
$h->check('health reports sqlite storage', ($health['storage']['driver'] ?? '') === 'sqlite');
$h->check('health reports PHP version', ($health['php'] ?? '') !== '');
$h->check('health advertises svg export', in_array('svg', $health['export'] ?? [], true));

out( "\ndocuments\n");
[$status, $created] = call($app, 'POST', '/api/documents', ['document' => sampleDocument()]);
$h->check('POST /api/documents returns 201', $status === 201, (string) $status);
$id = (string) ($created['id'] ?? '');
$h->check('created document has an id', str_starts_with($id, 'doc_'), $id);
$h->check('created document starts at revision 1', ($created['revision'] ?? 0) === 1);
$h->check('created document reports object count', ($created['objects'] ?? 0) === 2, (string) ($created['objects'] ?? -1));
$h->check('created document keeps the artboard size', (float) ($created['width'] ?? 0) === 640.0);

[$status, $list] = call($app, 'GET', '/api/documents');
$h->check('GET /api/documents lists the document', $status === 200 && count($list['documents'] ?? []) === 1);
$h->check('list summary excludes the payload', !isset($list['documents'][0]['document']));

[$status, $found] = call($app, 'GET', '/api/documents/' . $id);
$h->check('GET /api/documents/{id} returns the payload', $status === 200 && ($found['document']['name'] ?? '') === 'API Test Artwork');
$h->check('stored payload normalises colour case', ($found['document']['layers'][0]['children'][0]['fill']['color'] ?? '') === '#3b6ea5');

[$status, $missing] = call($app, 'GET', '/api/documents/doc_missing');
$h->check('unknown document returns 404', $status === 404, (string) $status);

out( "\nrevisions\n");
$edit = sampleDocument('API Test Artwork');
$edit['layers'][0]['children'][0]['fill']['color'] = '#e3573f';
[$status, $updated] = call($app, 'PUT', '/api/documents/' . $id, ['document' => $edit, 'baseRevision' => 1]);
$h->check('PUT with the current revision returns 200', $status === 200, (string) $status);
$h->check('PUT increments the revision', ($updated['revision'] ?? 0) === 2);

[$status, $conflict] = call($app, 'PUT', '/api/documents/' . $id, ['document' => $edit, 'baseRevision' => 1]);
$h->check('stale baseRevision returns 409', $status === 409, (string) $status);
$h->check('conflict reports the current revision', ($conflict['details']['revision'] ?? 0) === 2);

[$status, $revisions] = call($app, 'GET', '/api/documents/' . $id . '/revisions');
$h->check('revision history lists both revisions', $status === 200 && count($revisions['revisions'] ?? []) === 2);
$h->check('revision entries carry a timestamp', ($revisions['revisions'][0]['createdAt'] ?? '') !== '');
$h->check('revision entries carry a size', ($revisions['revisions'][0]['bytes'] ?? 0) > 0);

[$status, $restored] = call($app, 'POST', '/api/documents/' . $id . '/revisions/1/restore', []);
$h->check('restore returns 200', $status === 200, (string) $status);
$h->check('restore bumps the revision', ($restored['revision'] ?? 0) === 3);
$h->check('restored artwork reverts the colour', ($restored['document']['layers'][0]['children'][0]['fill']['color'] ?? '') === '#3b6ea5');

[$status, $renamed] = call($app, 'PATCH', '/api/documents/' . $id, ['name' => 'Renamed Artwork', 'starred' => true]);
$h->check('PATCH updates metadata only', $status === 200 && ($renamed['name'] ?? '') === 'Renamed Artwork');
$h->check('PATCH marks the document starred', ($renamed['starred'] ?? false) === true);
$h->check('metadata PATCH keeps artwork intact', ($renamed['document']['layers'][0]['children'][1]['text'] ?? '') === "VectorStudio\nReact + PHP");

out( "\nvalidation\n");
[$status] = call($app, 'POST', '/api/documents', ['document' => ['name' => 'No artboards']]);
$h->check('document without artboards is rejected', $status === 400, (string) $status);

[$status] = call($app, 'POST', '/api/documents', ['document' => ['artboards' => [['id' => 'a', 'w' => 10, 'h' => 10]], 'layers' => 'nope']]);
$h->check('layers must be a collection', $status === 400, (string) $status);

$brokenPath = sampleDocument();
$brokenPath['layers'][0]['children'][0]['subpaths'] = [];
[$status] = call($app, 'POST', '/api/documents', ['document' => $brokenPath]);
$h->check('path without nodes is rejected', $status === 400, (string) $status);

$badColor = sampleDocument();
$badColor['layers'][0]['children'][0]['fill']['color'] = 'javascript:alert(1)';
[$status, $sanitized] = call($app, 'POST', '/api/documents', ['document' => $badColor]);
$h->check('invalid colours fall back to a safe default', $status === 201
    && ($sanitized['document']['layers'][0]['children'][0]['fill']['color'] ?? '') === '#000000');

[$status] = call($app, 'POST', '/api/documents', 'not-an-object');
$h->check('non-object payloads are rejected', $status === 400, (string) $status);

out( "\nexports\n");
[$status, $exported] = call($app, 'GET', '/api/documents/' . $id . '/export?format=svg');
$svg = $exported['raw'] ?? '';
$h->check('SVG export returns 200', $status === 200, (string) $status);
$h->check('SVG export has an svg root', str_contains($svg, '<svg xmlns="http://www.w3.org/2000/svg"'));
$h->check('SVG export contains the path', str_contains($svg, '<path id="rect1"'));
$h->check('SVG export contains the text', str_contains($svg, '<text id="text1"'));
$h->check('SVG export emits both type lines', substr_count($svg, '<tspan') === 2);
$h->check('SVG export closes the path', str_contains($svg, 'Z'));

[$status, $jsonExport] = call($app, 'GET', '/api/documents/' . $id . '/export?format=json');
$h->check('JSON export returns a document', $status === 200 && ($jsonExport['format'] ?? '') === 'vectorstudio/1');
$h->check('JSON export keeps the artwork', ($jsonExport['layers'][0]['children'][1]['text'] ?? '') === "VectorStudio\nReact + PHP");

[$status] = call($app, 'GET', '/api/documents/' . $id . '/export?format=pdf');
$h->check('unknown export format returns 400', $status === 400, (string) $status);

out( "\nassets\n");
$png = base64_encode((string) hex2bin('89504e470d0a1a0a0000000d49484452'));
[$status, $asset] = call($app, 'POST', '/api/documents/' . $id . '/assets', [
    'format' => 'png',
    'filename' => 'render.png',
    'data' => 'data:image/png;base64,' . $png,
]);
$h->check('asset upload returns 201', $status === 201, (string) $status);
$h->check('asset response has a URL', str_starts_with((string) ($asset['url'] ?? ''), '/api/assets/'));

$assetId = (string) ($asset['id'] ?? '');
$fetch = $app->handle(new Request('GET', '/api/assets/' . $assetId));
$h->check('asset download returns the bytes', $fetch->status === 200 && $fetch->body === hex2bin('89504e470d0a1a0a0000000d49484452'));
$h->check('asset download sets the PNG type', ($fetch->headers['content-type'] ?? '') === 'image/png');

// Regression: a long-lived runtime can lose the asset directory (deploys,
// php-wasm stat caching). The next upload must recreate it instead of 500ing.
$assetsDir = $h->tempDir() . '/assets';
foreach (glob($assetsDir . '/*') ?: [] as $file) {
    unlink($file);
}
@rmdir($assetsDir);
[$status, $again] = call($app, 'POST', '/api/documents/' . $id . '/assets', [
    'format' => 'svg',
    'filename' => 'again.svg',
    'data' => base64_encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
]);
$h->check('upload recreates a missing asset directory', $status === 201, (string) $status);
$h->check('recreated directory serves the new asset', is_file($assetsDir . '/' . (string) ($again['id'] ?? '') . '.svg'));

[$status] = call($app, 'POST', '/api/documents/' . $id . '/assets', ['format' => 'exe', 'data' => $png]);
$h->check('unsupported asset format is rejected', $status === 400, (string) $status);
[$status] = call($app, 'POST', '/api/documents/' . $id . '/assets', ['format' => 'png', 'data' => 'not base64!!']);
$h->check('invalid base64 is rejected', $status === 400, (string) $status);

out( "\nsettings\n");
[$status, $settings] = call($app, 'PUT', '/api/settings', ['settings' => ['theme' => 'light', 'workspace' => 'Typography']]);
$h->check('PUT /api/settings stores values', $status === 200 && ($settings['settings']['theme'] ?? '') === 'light');
[$status, $read] = call($app, 'GET', '/api/settings');
$h->check('GET /api/settings returns stored values', ($read['settings']['workspace'] ?? '') === 'Typography');
[$status] = call($app, 'PUT', '/api/settings', []);
$h->check('empty settings update is rejected', $status === 400, (string) $status);

out( "\nstatic + spa\n");
$shell = $app->handle(new Request('GET', '/'));
$h->check('SPA shell is served at /', $shell->status === 200 && str_contains($shell->body, 'VectorStudio'));
$deep = $app->handle(new Request('GET', '/documents/abc'));
$h->check('client routes fall back to the shell', $deep->status === 200 && str_contains($deep->body, 'VectorStudio'));
$api404 = $app->handle(new Request('GET', '/api/nope'));
$h->check('unknown API route stays a 404', $api404->status === 404, (string) $api404->status);

out( "\ndelete\n");
[$status] = call($app, 'DELETE', '/api/documents/' . $id);
$h->check('DELETE removes the document', $status === 204, (string) $status);
[$status] = call($app, 'GET', '/api/documents/' . $id);
$h->check('deleted document is gone', $status === 404, (string) $status);
[$status] = call($app, 'DELETE', '/api/documents/' . $id);
$h->check('deleting twice returns 404', $status === 404, (string) $status);

exit($h->summarize());
