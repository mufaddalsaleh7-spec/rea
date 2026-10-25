<?php

declare(strict_types=1);

namespace TallyCraft;

/**
 * HTTP surface, PHP edition.
 *
 * Same paths, same payload shapes, same status codes as `src/server.js` — the
 * React client is written once and points at either backend. `handle()` returns
 * a response instead of echoing it, so the parity harness can drive this router
 * without a web server.
 */
final class Router
{
    private const NOT_FOUND_CODES = [
        'UNKNOWN_LEDGER',
        'UNKNOWN_GROUP',
        'UNKNOWN_VOUCHER',
        'UNKNOWN_STOCK_ITEM',
        'NO_COMPANY',
    ];

    public function __construct(
        private readonly Bootstrap $bootstrap,
        private readonly ?string $instanceUrl = null,
    ) {
    }

    /**
     * @param array<string, string> $query
     * @param array<string, mixed>|string|null $body
     * @return array{status: int, body: mixed}
     */
    public function handle(string $method, string $path, array $query = [], mixed $body = null): array
    {
        try {
            return $this->dispatch($method, $path, $query, $body);
        } catch (UnknownReport $error) {
            return [
                'status' => 404,
                'body' => ['error' => ['code' => 'UNKNOWN_REPORT', 'message' => $error->getMessage()]],
            ];
        } catch (TallyCraftError $error) {
            $status = in_array($error->errorCode, self::NOT_FOUND_CODES, true) ? 404 : 400;

            return [
                'status' => $status,
                'body' => [
                    'error' => [
                        'code' => $error->errorCode,
                        'message' => $error->getMessage(),
                        'details' => $error->details,
                    ],
                ],
            ];
        } catch (\Throwable $error) {
            return [
                'status' => 500,
                'body' => ['error' => ['code' => 'INTERNAL', 'message' => $error->getMessage()]],
            ];
        }
    }

    /**
     * @param array<string, string> $query
     * @param array<string, mixed>|string|null $body
     * @return array{status: int, body: mixed}
     */
    private function dispatch(string $method, string $path, array $query, mixed $body): array
    {
        $app = $this->bootstrap->app;
        $catalog = $this->bootstrap->catalog;
        $path = rtrim($path, '/') === '' ? '/' : rtrim($path, '/');

        if ($path === '/healthz') {
            return ['status' => 200, 'body' => 'ok'];
        }

        if ($path === '/api/instance') {
            return ['status' => 200, 'body' => [
                'service' => 'tallycraft',
                'status' => 'ok',
                'runtime' => 'php ' . PHP_VERSION,
                'pid' => getmypid(),
                'host' => '0.0.0.0',
                'port' => $this->bootstrap->config['port'],
                'publicUrl' => $this->instanceUrl,
                'environment' => $this->bootstrap->config['environment'],
                'release' => $this->bootstrap->config['release'],
                'database' => $this->bootstrap->config['dbPath'],
                'startedAt' => gmdate('Y-m-d\TH:i:s\Z'),
            ]];
        }

        if ($path === '/api/health') {
            $statistics = null;
            try {
                $statistics = $app->statistics();
            } catch (\Throwable) {
                $statistics = null;
            }

            return ['status' => 200, 'body' => [
                'ok' => true,
                'database' => $this->bootstrap->config['dbPath'],
                'statistics' => $statistics,
            ]];
        }

        if ($path === '/api/catalog') {
            return ['status' => 200, 'body' => [
                'groups' => $app->listGroups(),
                'primaryGroups' => $catalog->primaryGroups,
                'voucherTypes' => $catalog->voucherTypes,
                'units' => $catalog->units,
                'gstRates' => $catalog->gstRates,
            ]];
        }

        if ($path === '/api/company') {
            return ['status' => 200, 'body' => $app->getCompany()];
        }

        if ($path === '/api/statistics') {
            return ['status' => 200, 'body' => $app->statistics()];
        }

        if ($path === '/api/groups') {
            return ['status' => 200, 'body' => $app->listGroups()];
        }

        if ($path === '/api/ledgers') {
            if ($method === 'GET') {
                return ['status' => 200, 'body' => [
                    'ledgers' => $app->listLedgers(
                        $this->text($query, 'group'),
                        $this->text($query, 'search')
                    ),
                ]];
            }
            if ($method === 'POST') {
                return ['status' => 201, 'body' => $app->createLedger($this->jsonBody($body))];
            }
        }

        if (preg_match('#^/api/ledgers/(\d+)$#', $path, $match) === 1) {
            $id = (int) $match[1];
            if ($method === 'GET') {
                return ['status' => 200, 'body' => $app->getLedger($id)];
            }
            if ($method === 'PATCH' || $method === 'PUT') {
                return ['status' => 200, 'body' => $app->updateLedger($id, $this->jsonBody($body))];
            }
            if ($method === 'DELETE') {
                return ['status' => 200, 'body' => $app->deleteLedger($id)];
            }
        }

        if ($path === '/api/stock-items') {
            // The Node route answers with the full stock summary — the client
            // uses the same payload for the picker and the report.
            if ($method === 'POST') {
                return ['status' => 201, 'body' => $app->createStockItem($this->jsonBody($body))];
            }

            return ['status' => 200, 'body' => $app->stockSummary($this->text($query, 'asOf'))];
        }

        if ($path === '/api/vouchers') {
            if ($method === 'GET') {
                return ['status' => 200, 'body' => ['vouchers' => $app->listVouchers([
                    'from' => $this->text($query, 'from'),
                    'to' => $this->text($query, 'to'),
                    'type' => $this->text($query, 'type'),
                    'ledgerId' => $this->number($query, 'ledgerId'),
                    'search' => $this->text($query, 'search'),
                    'limit' => $this->number($query, 'limit') ?? 200,
                    'offset' => $this->number($query, 'offset') ?? 0,
                ])]];
            }
            if ($method === 'POST') {
                return ['status' => 201, 'body' => $app->createVoucher($this->jsonBody($body))];
            }
        }

        if ($path === '/api/vouchers/next') {
            $type = $this->text($query, 'type');
            if ($type === null) {
                throw new TallyCraftError('INVALID_PARAMETER', 'type is required');
            }
            $code = $catalog->resolveVoucherType($type);

            return ['status' => 200, 'body' => [
                'number' => $app->currentVoucherNumber($code, $this->text($query, 'date') ?? gmdate('Y-m-d')),
            ]];
        }

        if (preg_match('#^/api/vouchers/(\d+)$#', $path, $match) === 1) {
            $id = (int) $match[1];
            if ($method === 'GET') {
                return ['status' => 200, 'body' => $app->getVoucher($id)];
            }
            if ($method === 'DELETE') {
                return ['status' => 200, 'body' => $app->deleteVoucher($id)];
            }
        }

        if (preg_match('#^/api/reports/([a-z-]+)$#', $path, $match) === 1) {
            return $this->report($app, $match[1], $query);
        }

        if ($path === '/api/export/xml') {
            $xml = $app->exportXml(
                $this->text($query, 'from'),
                $this->text($query, 'to'),
                $this->text($query, 'masters') !== 'false',
                $this->text($query, 'vouchers') !== 'false'
            );

            return ['status' => 200, 'body' => $xml];
        }

        if ($path === '/api/import/xml' && $method === 'POST') {
            return ['status' => 200, 'body' => $app->importXml(
                is_string($body) ? $body : '',
                true,
                $this->text($query, 'dryRun') === 'true'
            )];
        }

        if ($path === '/api/demo/reset' && $method === 'POST') {
            $seed = new Seed(
                $this->bootstrap->db,
                (string) $this->bootstrap->config['seedPath'],
                $catalog
            );

            return ['status' => 200, 'body' => $seed->load(true)];
        }

        if (str_starts_with($path, '/api/')) {
            return ['status' => 404, 'body' => [
                'error' => ['code' => 'NOT_FOUND', 'message' => "No route for {$method} {$path}"],
            ]];
        }

        return ['status' => 404, 'body' => [
            'error' => ['code' => 'NOT_FOUND', 'message' => 'Not found'],
        ]];
    }

    /**
     * @param array<string, string> $query
     * @return array{status: int, body: mixed}
     */
    private function report(TallyCraft $app, string $name, array $query): array
    {
        $asOf = $this->text($query, 'asOf');
        $from = $this->text($query, 'from');
        $to = $this->text($query, 'to');

        $body = match ($name) {
            'trial-balance' => $app->trialBalance($asOf),
            'balance-sheet' => $app->balanceSheet($asOf),
            'profit-loss' => $app->profitLoss($from, $to),
            'day-book' => $app->dayBook($this->text($query, 'date')),
            'outstanding' => $app->outstanding($asOf, $this->text($query, 'type') ?? 'receivable'),
            'gst-summary' => $app->gstSummary($from, $to),
            'stock-summary' => $app->stockSummary($asOf),
            'ledger' => $app->ledgerReport(
                $this->number($query, 'ledgerId') ?? throw new TallyCraftError('INVALID_PARAMETER', 'ledgerId is required'),
                $from,
                $to
            ),
            default => throw new UnknownReport(sprintf('No report "%s"', $name)),
        };

        return ['status' => 200, 'body' => $body];
    }

    /** @param array<string, string> $query */
    private function text(array $query, string $key): ?string
    {
        $value = $query[$key] ?? null;

        return $value === null || $value === '' ? null : (string) $value;
    }

    /** @param array<string, string> $query */
    private function number(array $query, string $key): ?int
    {
        $value = $this->text($query, $key);

        return $value === null || !is_numeric($value) ? null : (int) $value;
    }

    /** @return array<string, mixed> */
    private function jsonBody(mixed $body): array
    {
        if (is_array($body)) {
            return $body;
        }
        if (is_string($body) && trim($body) !== '') {
            $decoded = json_decode($body, true);
            if (is_array($decoded)) {
                return $decoded;
            }
            throw new TallyCraftError('INVALID_JSON', 'Request body is not a JSON object');
        }

        return [];
    }
}
