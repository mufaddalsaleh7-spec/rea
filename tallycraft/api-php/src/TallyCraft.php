<?php

declare(strict_types=1);

namespace TallyCraft;

use PDO;

/**
 * TallyCraft service, PHP edition.
 *
 * A port of `src/app.js`, not a rewrite: the same schema, the same sign
 * convention (debit positive, credit negative), the same JSON shapes, so the
 * React client and the parity test cannot tell which backend answered. Every
 * figure is derived from `voucher_lines` at read time; nothing is cached, which
 * is why a trial balance cannot drift from the vouchers that produced it.
 */
final class TallyCraft
{
    /** Nesting depth for savepoints; see transaction(). */
    private int $savepointDepth = 0;

    public function __construct(
        private readonly PDO $db,
        private readonly Catalog $catalog,
    ) {
    }

    // ------------------------------------------------------------- companies

    /** @return array<string, mixed> */
    public function getCompany(): array
    {
        $company = $this->one('SELECT * FROM companies ORDER BY id LIMIT 1');
        if ($company === null) {
            throw new TallyCraftError('NO_COMPANY', 'No company is loaded. Create one in Masters.');
        }

        return [
            'id' => (int) $company['id'],
            'name' => $company['name'],
            'mailingName' => $company['mailing_name'],
            'address' => $company['address'],
            'gstin' => $company['gstin'],
            'state' => $company['state'],
            'financialYearStart' => $company['financial_year_start'],
            'financialYearEnd' => $company['financial_year_end'],
            'baseCurrency' => $company['base_currency'],
        ];
    }

    // ---------------------------------------------------------------- groups

    /** @return array<int, array<string, mixed>> */
    public function listGroups(): array
    {
        $rows = $this->all(
            'SELECT g.name, g.parent, g.nature, g.natural,
                    (SELECT COUNT(*) FROM ledgers l WHERE l.group_id = g.id) AS ledger_count
             FROM groups g
             ORDER BY g.nature, g.parent IS NOT NULL, g.name'
        );

        return array_map(static fn (array $row): array => [
            'name' => $row['name'],
            'parent' => $row['parent'],
            'nature' => $row['nature'],
            'natural' => $row['natural'],
            'ledger_count' => (int) $row['ledger_count'],
        ], $rows);
    }

    /**
     * Group nodes with children, parents before children, in catalogue order.
     *
     * @return array{byName: array<string, array<string, mixed>>, roots: array<int, array<string, mixed>>}
     */
    public function groupTree(): array
    {
        $rows = $this->all('SELECT * FROM groups');
        $byName = [];
        foreach ($rows as $row) {
            $byName[(string) $row['name']] = [
                'id' => (int) $row['id'],
                'name' => $row['name'],
                'parent' => $row['parent'],
                'nature' => $row['nature'],
                'natural' => $row['natural'],
                'predefined' => (int) $row['predefined'] === 1,
                'groups' => [],
                'ledgers' => [],
                'total' => 0,
            ];
        }
        foreach ($byName as $name => $node) {
            if ($node['parent'] !== null && isset($byName[$node['parent']])) {
                $byName[$node['parent']]['groups'][] = &$byName[$name];
            }
        }

        $order = array_flip($this->catalog->primaryGroupNames());
        $roots = [];
        foreach ($byName as $name => $node) {
            if ($node['parent'] === null) {
                $roots[] = &$byName[$name];
            }
        }
        usort($roots, static function (array $a, array $b) use ($order): int {
            $left = $order[$a['name']] ?? 999;
            $right = $order[$b['name']] ?? 999;

            return $left <=> $right;
        });

        return ['byName' => $byName, 'roots' => $roots];
    }

    // --------------------------------------------------------------- ledgers

    /** @return array<int, array<string, mixed>> */
    public function ledgerRows(): array
    {
        $rows = $this->all(
            'SELECT l.*, g.name AS group_name, g.nature, g.natural
             FROM ledgers l JOIN groups g ON g.id = l.group_id
             ORDER BY g.name, l.name COLLATE NOCASE'
        );

        return array_map(fn (array $row): array => $this->mapLedger($row), $rows);
    }

    /** @param array<string, mixed> $row */
    private function mapLedger(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'name' => $row['name'],
            'group' => $row['group_name'],
            'groupId' => (int) $row['group_id'],
            'nature' => $row['nature'],
            'natural' => $row['natural'],
            'opening' => Money::toRupees((int) $row['opening_paise']),
            'openingPaise' => (int) $row['opening_paise'],
            'openingDated' => $row['opening_dated'],
            'gstin' => $row['gstin'],
            'partyType' => $row['party_type'],
            'mailingName' => $row['mailing_name'],
            'address' => $row['address'],
            'phone' => $row['phone'],
            'creditDays' => $row['credit_days'] === null ? null : (int) $row['credit_days'],
            'isActive' => (int) $row['is_active'] === 1,
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function listLedgers(?string $group = null, ?string $search = null): array
    {
        $rows = $this->ledgerRows();
        $query = $search === null ? null : strtolower(trim($search));

        return array_values(array_filter($rows, static function (array $ledger) use ($group, $query): bool {
            if ($group !== null && $ledger['group'] !== $group) {
                return false;
            }
            if ($query === null || $query === '') {
                return true;
            }

            return str_contains(strtolower((string) $ledger['name']), $query);
        }));
    }

    /** @return array<string, mixed> */
    public function getLedger(int $id): array
    {
        $row = $this->one(
            'SELECT l.*, g.name AS group_name, g.nature, g.natural
             FROM ledgers l JOIN groups g ON g.id = l.group_id WHERE l.id = ?',
            [$id]
        );
        if ($row === null) {
            throw new TallyCraftError('UNKNOWN_LEDGER', "No ledger with id {$id}");
        }

        return $this->mapLedger($row);
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function createLedger(array $input): array
    {
        $name = self::normaliseName($input['name'] ?? '');
        if ($name === '') {
            throw new TallyCraftError('INVALID_NAME', 'Ledger name is required');
        }
        $group = $this->resolveGroup((string) ($input['group'] ?? ''));
        $existing = $this->one('SELECT id FROM ledgers WHERE name = ? COLLATE NOCASE', [$name]);
        if ($existing !== null) {
            throw new TallyCraftError(
                'DUPLICATE_LEDGER',
                sprintf('Ledger "%s" already exists', $name),
                ['id' => (int) $existing['id']]
            );
        }

        $openingPaise = 0;
        if (isset($input['opening']) && $input['opening'] !== '') {
            $magnitude = abs($this->parseSignedAmount($input['opening'], null));
            $direction = (string) ($input['openingType'] ?? $group['natural']);
            $openingPaise = $direction === 'Cr' ? -$magnitude : $magnitude;
        }

        $partyType = $input['partyType'] ?? match ($group['name']) {
            'Sundry Debtors' => 'debtor',
            'Sundry Creditors' => 'creditor',
            default => null,
        };

        $this->run(
            'INSERT INTO ledgers
             (name, group_id, opening_paise, opening_dated, gstin, party_type,
              mailing_name, address, phone, credit_days, is_active, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)',
            [
                $name,
                (int) $group['id'],
                $openingPaise,
                $input['openingDated'] ?? null,
                $input['gstin'] ?? null,
                $partyType,
                $input['mailingName'] ?? $name,
                $input['address'] ?? null,
                $input['phone'] ?? null,
                isset($input['creditDays']) ? (int) $input['creditDays'] : null,
                self::now(),
            ]
        );

        return $this->getLedger((int) $this->db->lastInsertId());
    }

    /** @return array<string, mixed> */
    private function resolveGroup(string $name): array
    {
        $normalised = self::normaliseName($name);
        $group = $this->one('SELECT * FROM groups WHERE name = ? COLLATE NOCASE', [$normalised]);
        if ($group === null) {
            throw new TallyCraftError(
                'UNKNOWN_GROUP',
                sprintf('No group named "%s"', $name),
                ['groups' => $this->catalog->primaryGroupNames()]
            );
        }

        return $group;
    }

    /** @param array<string, mixed> $patch */
    public function updateLedger(int $id, array $patch): array
    {
        $existing = $this->getLedger($id);
        $group = isset($patch['group']) ? $this->resolveGroup((string) $patch['group']) : null;
        $name = isset($patch['name']) ? self::normaliseName((string) $patch['name']) : (string) $existing['name'];
        if ($name === '') {
            throw new TallyCraftError('INVALID_NAME', 'Ledger name is required');
        }
        $clash = $this->one('SELECT id FROM ledgers WHERE name = ? COLLATE NOCASE AND id <> ?', [$name, $id]);
        if ($clash !== null) {
            throw new TallyCraftError('DUPLICATE_LEDGER', sprintf('Ledger "%s" exists', $name));
        }

        if (!isset($patch['opening'])) {
            $openingPaise = (int) $existing['openingPaise'];
        } else {
            $direction = (string) ($patch['openingType'] ?? $existing['natural']);
            $magnitude = abs($this->parseSignedAmount($patch['opening'], null));
            $openingPaise = $direction === 'Cr' ? -$magnitude : $magnitude;
        }

        $this->run(
            'UPDATE ledgers SET name = ?, group_id = ?, opening_paise = ?, gstin = ?, party_type = ?,
             mailing_name = ?, address = ?, phone = ?, credit_days = ? WHERE id = ?',
            [
                $name,
                $group === null ? (int) $existing['groupId'] : (int) $group['id'],
                $openingPaise,
                $patch['gstin'] ?? $existing['gstin'],
                $patch['partyType'] ?? $existing['partyType'],
                $patch['mailingName'] ?? $existing['mailingName'],
                $patch['address'] ?? $existing['address'],
                $patch['phone'] ?? $existing['phone'],
                $patch['creditDays'] ?? $existing['creditDays'],
                $id,
            ]
        );

        return $this->getLedger($id);
    }

    /** @return array{deleted: int} */
    public function deleteLedger(int $id): array
    {
        $ledger = $this->getLedger($id);
        $used = (int) ($this->one('SELECT COUNT(*) AS n FROM voucher_lines WHERE ledger_id = ?', [$id])['n'] ?? 0);
        if ($used > 0) {
            throw new TallyCraftError(
                'LEDGER_IN_USE',
                sprintf('"%s" is used by %d voucher line(s); delete those vouchers first', $ledger['name'], $used)
            );
        }
        $this->run('DELETE FROM ledgers WHERE id = ?', [$id]);

        return ['deleted' => $id];
    }

    /** @param array<string, mixed> $input */
    public function createStockItem(array $input): array
    {
        $name = self::normaliseName((string) ($input['name'] ?? ''));
        if ($name === '') {
            throw new TallyCraftError('INVALID_NAME', 'Stock item name is required');
        }
        if ($this->one('SELECT id FROM stock_items WHERE name = ? COLLATE NOCASE', [$name]) !== null) {
            throw new TallyCraftError('DUPLICATE_STOCK_ITEM', sprintf('Stock item "%s" already exists', $name));
        }
        $quantity = (float) ($input['openingQty'] ?? 0);
        $value = (float) ($input['openingValue'] ?? 0);
        if (!is_finite($quantity) || !is_finite($value)) {
            throw new TallyCraftError('INVALID_QUANTITY', 'Opening quantity and value must be numeric');
        }
        $unit = self::normaliseName((string) ($input['unit'] ?? 'Nos')) ?: 'Nos';
        $this->run(
            'INSERT INTO stock_items (name, stock_group, unit, opening_qty_milli, opening_value_paise, gst_rate, hsn)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                $name,
                $input['group'] ?? null,
                $unit,
                (int) round($quantity * 1000),
                (int) round($value * 100),
                (float) ($input['gstRate'] ?? 0),
                $input['hsn'] ?? null,
            ]
        );

        return [
            'id' => (int) $this->db->lastInsertId(),
            'name' => $name,
            'group' => $input['group'] ?? null,
            'unit' => $unit,
            // The Node route echoes the numbers as entered, not the stored
            // milli-units, so the client can toast exactly what it sent.
            'openingQty' => $quantity,
            'openingValue' => $value,
            'gstRate' => (float) ($input['gstRate'] ?? 0),
            'hsn' => $input['hsn'] ?? null,
        ];
    }

    // -------------------------------------------------------------- vouchers

    public function currentVoucherNumber(string $type, string $date): string
    {
        $company = $this->getCompany();
        $definition = $this->catalog->voucherType($type);
        if ($definition === null) {
            throw new TallyCraftError('UNKNOWN_VOUCHER_TYPE', $type);
        }
        $rows = $this->all(
            'SELECT number FROM vouchers WHERE type = ? AND date BETWEEN ? AND ?',
            [$type, $company['financialYearStart'], $company['financialYearEnd']]
        );
        $prefix = (string) $definition['prefix'];
        $highest = 0;
        foreach ($rows as $row) {
            if (preg_match('/^' . preg_quote($prefix, '/') . '-(\d+)$/', (string) $row['number'], $match) === 1) {
                $highest = max($highest, (int) $match[1]);
            }
        }

        return $prefix . '-' . str_pad((string) ($highest + 1), 4, '0', STR_PAD_LEFT);
    }

    /**
     * @param array<string, mixed> $input
     * @return array{voucher: array<string, mixed>, warnings: array<int, array<string, string>>}
     */
    public function createVoucher(array $input): array
    {
        $company = $this->getCompany();
        $type = $this->catalog->resolveVoucherType((string) ($input['type'] ?? ''));
        $date = self::assertIsoDate((string) ($input['date'] ?? gmdate('Y-m-d')));
        if ($date < $company['financialYearStart'] || $date > $company['financialYearEnd']) {
            throw new TallyCraftError(
                'OUTSIDE_FINANCIAL_YEAR',
                sprintf('%s is outside %s..%s', $date, $company['financialYearStart'], $company['financialYearEnd'])
            );
        }
        $lines = $this->normaliseLines($input['lines'] ?? []);
        $total = array_sum(array_map(static fn (array $line): int => (int) $line['amountPaise'], $lines));
        if ($total !== 0) {
            throw new TallyCraftError('UNBALANCED', 'Debits and credits must agree', [
                'differencePaise' => $total,
                'difference' => Money::formatPaise(abs($total)),
            ]);
        }
        $number = self::normaliseName((string) ($input['number'] ?? ''));
        if ($number === '') {
            $number = $this->currentVoucherNumber($type, $date);
        }
        if ($this->one('SELECT id FROM vouchers WHERE type = ? AND number = ?', [$type, $number]) !== null) {
            throw new TallyCraftError('DUPLICATE_VOUCHER', sprintf('Voucher %s already exists', $number), [
                'next' => $this->currentVoucherNumber($type, $date),
            ]);
        }
        $party = null;
        if (isset($input['partyLedgerId']) && $input['partyLedgerId'] !== null) {
            $party = $this->findLedger($input['partyLedgerId']);
        } else {
            $party = $this->inferParty($type, $lines);
        }
        $grossPaise = 0;
        foreach ($lines as $line) {
            if ((int) $line['amountPaise'] > 0) {
                $grossPaise += (int) $line['amountPaise'];
            }
        }
        $warnings = $this->voucherWarnings($type, $lines);
        $now = self::now();

        $voucherId = $this->transaction(function () use ($type, $number, $date, $input, $party, $grossPaise, $now, $lines): int {
                $this->run(
                    'INSERT INTO vouchers (type, number, date, narration, reference, party_ledger_id, total_paise, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        $type,
                        $number,
                        $date,
                        $input['narration'] ?? null,
                        $input['reference'] ?? null,
                        $party['id'] ?? null,
                        $grossPaise,
                        $now,
                        $now,
                    ]
                );
                $voucherId = (int) $this->db->lastInsertId();
                foreach ($lines as $line) {
                    $this->run(
                        'INSERT INTO voucher_lines (voucher_id, ledger_id, amount_paise, bill_ref, position) VALUES (?, ?, ?, ?, ?)',
                        [$voucherId, (int) $line['ledgerId'], (int) $line['amountPaise'], $line['billRef'], (int) $line['position']]
                    );
                }
                $this->insertInventory($voucherId, $type, $input['inventory'] ?? []);

                return $voucherId;
        });

        return ['voucher' => $this->getVoucher($voucherId), 'warnings' => $warnings];
    }

    /**
     * @param array<int, array<string, mixed>> $lines
     * @return array<int, array<string, mixed>>
     */
    private function normaliseLines(array $lines): array
    {
        if (count($lines) < 2) {
            throw new TallyCraftError('TOO_FEW_LINES', 'A voucher needs at least two ledger entries');
        }
        $normalised = [];
        foreach (array_values($lines) as $index => $line) {
            $ledger = $this->findLedger($line['ledgerId'] ?? $line['ledger'] ?? $line['ledgerName'] ?? null);
            if ($ledger['group'] === 'Stock-in-Hand') {
                throw new TallyCraftError(
                    'RESERVED_GROUP',
                    sprintf('"%s" belongs to Stock-in-Hand, which is owned by the inventory reports', $ledger['name'])
                );
            }
            if (isset($line['debit'])) {
                $paise = abs($this->parseSignedAmount($line['debit'], 'Dr'));
            } elseif (isset($line['credit'])) {
                $paise = -abs($this->parseSignedAmount($line['credit'], 'Cr'));
            } elseif (isset($line['amount'])) {
                $paise = $this->parseSignedAmount($line['amount'], (string) ($line['type'] ?? 'Dr'));
            } else {
                throw new TallyCraftError('INVALID_AMOUNT', sprintf('Line %d has no amount', $index + 1));
            }
            if ($paise === 0) {
                throw new TallyCraftError('INVALID_AMOUNT', sprintf('Line %d has a zero amount', $index + 1));
            }
            $normalised[] = [
                'ledgerId' => (int) $ledger['id'],
                'ledgerName' => $ledger['name'],
                'group' => $ledger['group'],
                'amountPaise' => $paise,
                'billRef' => $line['billRef'] ?? null,
                'position' => $index,
            ];
        }

        return $normalised;
    }

    /**
     * @param array<int, array<string, mixed>> $lines
     * @return array<int, array<string, string>>
     */
    private function voucherWarnings(string $type, array $lines): array
    {
        $definition = $this->catalog->voucherType($type);
        $warnings = [];
        if ($definition !== null && isset($definition['requires']['anyOf'])) {
            $groups = array_map(static fn (array $line): string => (string) $line['group'], $lines);
            $allowed = $definition['requires']['anyOf'];
            if (array_intersect($allowed, $groups) === []) {
                $warnings[] = ['code' => 'UNUSUAL_LEDGER_GROUP', 'message' => (string) $definition['requires']['hint']];
            }
        }
        $debits = 0;
        $credits = 0;
        foreach ($lines as $line) {
            if ((int) $line['amountPaise'] > 0) {
                $debits++;
            } elseif ((int) $line['amountPaise'] < 0) {
                $credits++;
            }
        }
        if ($debits === 0 || $credits === 0) {
            $warnings[] = [
                'code' => 'ONE_SIDED',
                'message' => 'Every voucher should carry at least one debit and one credit',
            ];
        }

        return $warnings;
    }

    /**
     * @param array<int, array<string, mixed>> $lines
     * @return array<string, mixed>|null
     */
    private function inferParty(string $type, array $lines): ?array
    {
        $preferred = match ($type) {
            'SALES', 'CREDIT_NOTE' => 'Sundry Debtors',
            'PURCHASE', 'DEBIT_NOTE' => 'Sundry Creditors',
            default => null,
        };
        if ($preferred === null) {
            return null;
        }
        foreach ($lines as $line) {
            if ($line['group'] === $preferred) {
                return $this->getLedger((int) $line['ledgerId']);
            }
        }

        return null;
    }

    /**
     * @param array<int, array<string, mixed>> $inventory
     */
    private function insertInventory(int $voucherId, string $type, array $inventory): void
    {
        if ($inventory === []) {
            return;
        }
        $direction = match ($type) {
            'PURCHASE', 'CREDIT_NOTE' => 1,
            'SALES', 'DEBIT_NOTE' => -1,
            default => 0,
        };
        if ($direction === 0) {
            throw new TallyCraftError(
                'INVENTORY_ON_ACCOUNTING_VOUCHER',
                'Inventory lines are only supported on sales, purchase, credit-note and debit-note vouchers'
            );
        }
        foreach ($inventory as $entry) {
            $item = $this->one(
                'SELECT * FROM stock_items WHERE id = ? OR name = ? COLLATE NOCASE',
                [isset($entry['itemId']) ? (int) $entry['itemId'] : -1, (string) ($entry['item'] ?? $entry['itemName'] ?? '')]
            );
            if ($item === null) {
                throw new TallyCraftError(
                    'UNKNOWN_STOCK_ITEM',
                    sprintf('No stock item "%s"', (string) ($entry['item'] ?? $entry['itemId'] ?? ''))
                );
            }
            $qty = (int) self::jsRound(((float) ($entry['quantity'] ?? $entry['qty'] ?? 0)) * 1000);
            if ($qty <= 0) {
                throw new TallyCraftError('INVALID_QUANTITY', 'Inventory quantity must be positive');
            }
            $ratePaise = isset($entry['rate']) ? $this->parseSignedAmount($entry['rate'], 'Dr') : 0;
            $amountPaise = isset($entry['amount'])
                ? abs($this->parseSignedAmount($entry['amount'], 'Dr'))
                : (int) self::jsRound(($qty * $ratePaise) / 1000);
            $this->run(
                'INSERT INTO voucher_inventory (voucher_id, stock_item_id, qty_milli, rate_paise, amount_paise) VALUES (?, ?, ?, ?, ?)',
                [$voucherId, (int) $item['id'], $direction * $qty, $ratePaise, $amountPaise]
            );
        }
    }

    /** @return array<string, mixed> */
    public function getVoucher(int $id): array
    {
        $voucher = $this->one('SELECT * FROM vouchers WHERE id = ?', [$id]);
        if ($voucher === null) {
            throw new TallyCraftError('UNKNOWN_VOUCHER', "No voucher with id {$id}");
        }
        $lines = $this->all(
            'SELECT vl.*, l.name AS ledger_name, g.name AS group_name
             FROM voucher_lines vl
             JOIN ledgers l ON l.id = vl.ledger_id
             JOIN groups g ON g.id = l.group_id
             WHERE vl.voucher_id = ? ORDER BY vl.position',
            [$id]
        );
        $inventory = $this->all(
            'SELECT vi.*, si.name AS item_name, si.unit
             FROM voucher_inventory vi JOIN stock_items si ON si.id = vi.stock_item_id
             WHERE vi.voucher_id = ?',
            [$id]
        );
        $party = $voucher['party_ledger_id'] === null ? null : $this->getLedger((int) $voucher['party_ledger_id']);

        return [
            'id' => (int) $voucher['id'],
            'type' => $voucher['type'],
            'typeName' => $this->catalog->voucherTypeName((string) $voucher['type']),
            'number' => $voucher['number'],
            'date' => $voucher['date'],
            'narration' => $voucher['narration'],
            'reference' => $voucher['reference'],
            'party' => $party,
            'total' => Money::toRupees((int) $voucher['total_paise']),
            'lines' => array_map(static function (array $line): array {
                $paise = (int) $line['amount_paise'];

                return [
                    'id' => (int) $line['id'],
                    'ledgerId' => (int) $line['ledger_id'],
                    'ledger' => $line['ledger_name'],
                    'group' => $line['group_name'],
                    'amount' => Money::toRupees($paise),
                    'debit' => $paise > 0 ? Money::toRupees($paise) : 0,
                    'credit' => $paise < 0 ? Money::toRupees(-$paise) : 0,
                    'billRef' => $line['bill_ref'],
                ];
            }, $lines),
            'inventory' => array_map(static fn (array $row): array => [
                'item' => $row['item_name'],
                'unit' => $row['unit'],
                'quantity' => ((int) $row['qty_milli']) / 1000,
                'rate' => Money::toRupees((int) $row['rate_paise']),
                'amount' => Money::toRupees((int) $row['amount_paise']),
            ], $inventory),
        ];
    }

    /**
     * @param array<string, mixed> $filters
     * @return array<int, array<string, mixed>>
     */
    public function listVouchers(array $filters = []): array
    {
        $from = $filters['from'] ?? null;
        $to = $filters['to'] ?? null;
        $type = $filters['type'] ?? null;
        $ledgerId = $filters['ledgerId'] ?? null;
        $search = $filters['search'] ?? null;
        $limit = (int) ($filters['limit'] ?? 200);
        $offset = (int) ($filters['offset'] ?? 0);

        $clauses = [];
        $params = [];
        if ($from !== null) {
            $clauses[] = 'v.date >= ?';
            $params[] = $from;
        }
        if ($to !== null) {
            $clauses[] = 'v.date <= ?';
            $params[] = $to;
        }
        if ($type !== null) {
            $clauses[] = 'v.type = ?';
            $params[] = $this->catalog->resolveVoucherType((string) $type);
        }
        if ($ledgerId !== null) {
            $clauses[] = 'EXISTS (SELECT 1 FROM voucher_lines vl WHERE vl.voucher_id = v.id AND vl.ledger_id = ?)';
            $params[] = (int) $ledgerId;
        }
        if ($search !== null && trim((string) $search) !== '') {
            $clauses[] = '(v.narration LIKE ? OR v.number LIKE ? OR v.reference LIKE ?)';
            $needle = '%' . trim((string) $search) . '%';
            array_push($params, $needle, $needle, $needle);
        }
        $where = $clauses === [] ? '' : 'WHERE ' . implode(' AND ', $clauses);
        $params[] = max(1, min($limit === 0 ? 200 : $limit, 1000));
        $params[] = max(0, $offset);

        $rows = $this->all(
            "SELECT v.*, l.name AS party_name
             FROM vouchers v LEFT JOIN ledgers l ON l.id = v.party_ledger_id
             {$where} ORDER BY v.date DESC, v.id DESC LIMIT ? OFFSET ?",
            $params
        );

        return array_map(fn (array $row): array => [
            'id' => (int) $row['id'],
            'type' => $row['type'],
            'typeName' => $this->catalog->voucherTypeName((string) $row['type']),
            'number' => $row['number'],
            'date' => $row['date'],
            'narration' => $row['narration'],
            'reference' => $row['reference'],
            'party' => $row['party_name'],
            'total' => Money::toRupees((int) $row['total_paise']),
        ], $rows);
    }

    /** @return array<string, mixed> */
    public function deleteVoucher(int $id): array
    {
        $voucher = $this->getVoucher($id);
        $this->run('DELETE FROM vouchers WHERE id = ?', [$id]);

        return ['deleted' => $voucher['id'], 'number' => $voucher['number']];
    }

    // --------------------------------------------------------------- reports

    /**
     * Signed movements per ledger: before `from`, and inside [from, to].
     *
     * @return array<int, array{before: int, between: int}>
     */
    private function movements(string $from, string $to): array
    {
        $rows = $this->all(
            'SELECT vl.ledger_id AS ledgerId,
                    COALESCE(SUM(CASE WHEN v.date < ? THEN vl.amount_paise ELSE 0 END), 0) AS before,
                    COALESCE(SUM(CASE WHEN v.date >= ? AND v.date <= ? THEN vl.amount_paise ELSE 0 END), 0) AS inside
             FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id
             GROUP BY vl.ledger_id',
            [$from, $from, $to]
        );
        $map = [];
        foreach ($rows as $row) {
            $map[(int) $row['ledgerId']] = ['before' => (int) $row['before'], 'between' => (int) $row['inside']];
        }

        return $map;
    }

    /** @return array<int, array<string, mixed>> */
    public function balancesAt(string $asOf): array
    {
        return $this->balances('0000-01-01', $asOf);
    }

    /** @return array<int, array<string, mixed>> */
    public function balancesIn(string $from, string $to): array
    {
        return $this->balances($from, $to, true);
    }

    /** @return array<int, array<string, mixed>> */
    private function balances(string $from, string $to, bool $window = false): array
    {
        $movements = $this->movements($from, $to);
        $rows = [];
        foreach ($this->ledgerRows() as $ledger) {
            $movement = $movements[$ledger['id']] ?? ['before' => 0, 'between' => 0];
            $row = $ledger;
            $row['balancePaise'] = $ledger['openingPaise'] + $movement['before'] + $movement['between'];
            if ($window) {
                $row['openingPaise'] = $ledger['openingPaise'] + $movement['before'];
                $row['movementPaise'] = $movement['between'];
            }
            $rows[] = $row;
        }

        return $rows;
    }

    /**
     * Attach balances to the group tree and total every node bottom-up.
     *
     * @param array<int, array<string, mixed>> $balances
     * @return array{roots: array<int, array<string, mixed>>}
     */
    private function rollup(array $balances): array
    {
        $tree = $this->groupTree();
        $byName = $tree['byName'];
        foreach ($balances as $ledger) {
            $name = (string) $ledger['group'];
            if (isset($byName[$name])) {
                $byName[$name]['ledgers'][] = $ledger;
            }
        }
        $this->feed($tree['byName'], $balances);

        return ['roots' => $this->rootsOf($tree['byName'])];
    }

    /**
     * Rebuild the tree with balances attached. PHP arrays are values, so the
     * references used while building nodes are re-established here.
     *
     * @param array<string, array<string, mixed>> $byName
     * @param array<int, array<string, mixed>> $balances
     */
    private function feed(array &$byName, array $balances): void
    {
        foreach ($byName as $name => &$node) {
            $node['groups'] = [];
            $node['ledgers'] = [];
        }
        unset($node);
        foreach ($balances as $ledger) {
            $name = (string) $ledger['group'];
            if (isset($byName[$name])) {
                $byName[$name]['ledgers'][] = $ledger;
            }
        }
        foreach ($byName as $name => $node) {
            if ($node['parent'] !== null && isset($byName[$node['parent']])) {
                $byName[$node['parent']]['groups'][] = $name;
            }
        }
        foreach ($byName as $name => &$node) {
            $node['total'] = $this->sumNode($name, $byName);
        }
        unset($node);
    }

    /** @param array<string, array<string, mixed>> $byName */
    private function sumNode(string $name, array &$byName): int
    {
        if (!isset($byName[$name])) {
            return 0;
        }
        $total = 0;
        foreach ($byName[$name]['ledgers'] as $ledger) {
            $total += (int) $ledger['balancePaise'];
        }
        foreach ($byName[$name]['groups'] as $childName) {
            $total += $this->sumNode((string) $childName, $byName);
        }

        return $total;
    }

    /**
     * @param array<string, array<string, mixed>> $byName
     * @return array<int, array<string, mixed>>
     */
    private function rootsOf(array &$byName): array
    {
        $order = array_flip($this->catalog->primaryGroupNames());
        $roots = [];
        foreach ($byName as $name => $node) {
            if ($node['parent'] === null) {
                $roots[] = $node;
            }
        }
        usort($roots, static fn (array $a, array $b): int => ($order[$a['name']] ?? 999) <=> ($order[$b['name']] ?? 999));

        foreach ($roots as $index => $root) {
            $roots[$index]['childNodes'] = array_map(
                fn (string $childName): array => $byName[$childName],
                $root['groups']
            );
        }

        return $roots;
    }

    /** @return array<string, mixed> */
    public function trialBalance(?string $asOf = null, bool $detailed = true): array
    {
        $company = $this->getCompany();
        $date = $asOf ?? $company['financialYearEnd'];
        self::assertIsoDate($date, 'asOf');
        $balances = $this->balancesAt($date);
        $roots = $this->rollup($balances)['roots'];

        $rows = [];
        $debitTotal = 0;
        $creditTotal = 0;
        $ledgerCount = 0;

        $push = static function (string $name, int $paise, string $kind, int $depth) use (&$rows): void {
            $rows[] = [
                'name' => $name,
                'kind' => $kind,
                'depth' => $depth,
                'debit' => $paise > 0 ? Money::toRupees($paise) : 0,
                'credit' => $paise < 0 ? Money::toRupees(-$paise) : 0,
                'balance' => Money::toRupees($paise),
            ];
        };

        $walk = function (array $node, int $depth) use (&$walk, $push, $detailed): void {
            $hasChildren = isset($node['childNodes']) && $node['childNodes'] !== [];
            if ((int) $node['total'] === 0 && ($node['ledgers'] ?? []) === [] && !$hasChildren) {
                return;
            }
            $push((string) $node['name'], (int) $node['total'], 'group', $depth);
            foreach ($node['childNodes'] ?? [] as $child) {
                $walk($child, $depth + 1);
            }
            if ($detailed) {
                foreach ($node['ledgers'] ?? [] as $ledger) {
                    if ((int) $ledger['balancePaise'] === 0) {
                        continue;
                    }
                    $push((string) $ledger['name'], (int) $ledger['balancePaise'], 'ledger', $depth + 1);
                }
            }
        };

        foreach ($roots as $root) {
            $walk($root, 0);
        }
        foreach ($balances as $ledger) {
            $paise = (int) $ledger['balancePaise'];
            if ($paise > 0) {
                $debitTotal += $paise;
            } else {
                $creditTotal -= $paise;
            }
            if ($paise !== 0) {
                $ledgerCount++;
            }
        }

        return [
            'asOf' => $date,
            'company' => $company['name'],
            'rows' => $rows,
            'totals' => [
                'debit' => Money::toRupees($debitTotal),
                'credit' => Money::toRupees($creditTotal),
            ],
            'balanced' => $debitTotal === $creditTotal,
            'difference' => Money::toRupees($debitTotal - $creditTotal),
            'ledgerCount' => $ledgerCount,
        ];
    }

    /**
     * @param array<int, array<string, mixed>> $roots
     * @return array<int, array<string, mixed>>
     */
    private function sectionRows(array $roots): array
    {
        return array_map(fn (array $root): array => [
            'name' => $root['name'],
            'amount' => Money::toRupees(abs((int) $root['total'])),
            'signed' => Money::toRupees((int) $root['total']),
            'ledgers' => array_values(array_map(static fn (array $ledger): array => [
                'name' => $ledger['name'],
                'amount' => Money::toRupees(abs((int) $ledger['balancePaise'])),
                'signed' => Money::toRupees((int) $ledger['balancePaise']),
            ], array_filter($root['ledgers'], static fn (array $ledger): bool => (int) $ledger['balancePaise'] !== 0))),
            'groups' => array_map(static fn (array $child): array => [
                'name' => $child['name'],
                'amount' => Money::toRupees(abs((int) $child['total'])),
                'ledgers' => array_values(array_map(static fn (array $ledger): array => [
                    'name' => $ledger['name'],
                    'amount' => Money::toRupees(abs((int) $ledger['balancePaise'])),
                    'signed' => Money::toRupees((int) $ledger['balancePaise']),
                ], array_filter($child['ledgers'], static fn (array $ledger): bool => (int) $ledger['balancePaise'] !== 0))),
            ], $root['childNodes'] ?? []),
        ], $roots);
    }

    /**
     * Replace the book value of Stock-in-Hand with the inventory-derived
     * closing stock, so the balance sheet agrees with the P&L.
     *
     * @param array<int, array<string, mixed>> $assetRows
     * @return array<int, array<string, mixed>>
     */
    private function applyClosingStock(array $assetRows, int $onBooksPaise, int $closingPaise): array
    {
        $found = false;
        foreach ($assetRows as $index => $row) {
            if ($row['name'] !== 'Current Assets') {
                continue;
            }
            $found = true;
            $groups = array_values(array_filter($row['groups'], static fn (array $group): bool => $group['name'] !== 'Stock-in-Hand'));
            $ledgers = array_values(array_filter($row['ledgers'], static fn (array $ledger): bool => $ledger['name'] !== 'Stock-in-Hand'));
            if ($closingPaise !== 0) {
                $groups[] = [
                    'name' => 'Stock-in-Hand',
                    'amount' => Money::toRupees($closingPaise),
                    'ledgers' => [[
                        'name' => 'Closing stock (inventory)',
                        'amount' => Money::toRupees($closingPaise),
                        'signed' => Money::toRupees($closingPaise),
                    ]],
                ];
            }
            $delta = $closingPaise - $onBooksPaise;
            $assetRows[$index]['groups'] = $groups;
            $assetRows[$index]['ledgers'] = $ledgers;
            $assetRows[$index]['amount'] = Money::toRupees(Money::toPaise($row['amount']) + $delta);
            $assetRows[$index]['signed'] = Money::toRupees(Money::toPaise($row['signed']) + $delta);
        }
        if (!$found && $closingPaise !== 0) {
            array_unshift($assetRows, [
                'name' => 'Current Assets',
                'amount' => Money::toRupees($closingPaise),
                'signed' => Money::toRupees($closingPaise),
                'groups' => [[
                    'name' => 'Stock-in-Hand',
                    'amount' => Money::toRupees($closingPaise),
                    'ledgers' => [[
                        'name' => 'Closing stock (inventory)',
                        'amount' => Money::toRupees($closingPaise),
                        'signed' => Money::toRupees($closingPaise),
                    ]],
                ]],
                'ledgers' => [],
            ]);
        }

        return $assetRows;
    }

    /** @return array<string, mixed> */
    public function balanceSheet(?string $asOf = null): array
    {
        $company = $this->getCompany();
        $date = $asOf ?? $company['financialYearEnd'];
        $balances = $this->balancesAt($date);
        $roots = $this->rollup($balances)['roots'];

        $liabilityRoots = array_values(array_filter($roots, static fn (array $root): bool => $root['nature'] === 'liabilities' && $root['name'] !== 'Profit & Loss A/c'));
        $reserveRoots = array_values(array_filter($roots, static fn (array $root): bool => $root['name'] === 'Profit & Loss A/c'));
        $assetRoots = array_values(array_filter($roots, static fn (array $root): bool => $root['nature'] === 'assets'));

        $profitAndLoss = $this->profitLoss($company['financialYearStart'], $date);
        $netProfitPaise = Money::toPaise($profitAndLoss['netProfit']);
        $reservesPaise = array_sum(array_map(static fn (array $root): int => (int) $root['total'], $reserveRoots));

        $stockOnBooksPaise = 0;
        foreach ($balances as $ledger) {
            if ($ledger['group'] === 'Stock-in-Hand') {
                $stockOnBooksPaise += (int) $ledger['balancePaise'];
            }
        }
        $stock = $this->stockRows($date);
        $closingStockPaise = $stock['totalPaise'];

        // Liabilities are credits: present them as positive figures.
        $liabilities = array_map(static fn (array $row): array => [
            ...$row,
            'amount' => self::negate($row['signed']),
        ], $this->sectionRows($liabilityRoots));
        foreach ($this->sectionRows($reserveRoots) as $row) {
            $liabilities[] = [...$row, 'amount' => self::negate($row['signed'])];
        }
        $assets = $this->applyClosingStock($this->sectionRows($assetRoots), $stockOnBooksPaise, $closingStockPaise);

        $liabilityTotalPaise = 0;
        foreach ($liabilityRoots as $root) {
            $liabilityTotalPaise += -(int) $root['total'];
        }
        $liabilityTotalPaise -= $reservesPaise;
        $assetTotalPaise = 0;
        foreach ($assetRoots as $root) {
            $assetTotalPaise += (int) $root['total'];
        }
        $assetTotalPaise = $assetTotalPaise - $stockOnBooksPaise + $closingStockPaise;
        $balanceSheetLiabilities = $liabilityTotalPaise + $netProfitPaise;

        return [
            'asOf' => $date,
            'company' => $company['name'],
            'liabilities' => $liabilities,
            'assets' => $assets,
            'profitAndLoss' => [
                'name' => 'Profit & Loss A/c',
                'amount' => Money::toRupees(abs($netProfitPaise)),
                'isLoss' => $netProfitPaise < 0,
            ],
            'reserves' => Money::toRupees(-$reservesPaise),
            'stock' => [
                'onBooks' => Money::toRupees($stockOnBooksPaise),
                'closing' => Money::toRupees($closingStockPaise),
            ],
            'totals' => [
                'liabilities' => Money::toRupees($balanceSheetLiabilities),
                'assets' => Money::toRupees($assetTotalPaise),
            ],
            'balanced' => $balanceSheetLiabilities === $assetTotalPaise,
            'difference' => Money::toRupees($assetTotalPaise - $balanceSheetLiabilities),
        ];
    }

    /** @return array<string, mixed> */
    public function profitLoss(?string $from = null, ?string $to = null): array
    {
        $company = $this->getCompany();
        $start = $from ?? $company['financialYearStart'];
        $end = $to ?? $company['financialYearEnd'];
        $balances = $this->balancesIn($start, $end);
        $roots = $this->rollup($balances)['roots'];

        $section = function (string $sectionName) use ($roots): array {
            $chosen = array_values(array_filter(
                $roots,
                fn (array $root): bool => $this->sectionFor((string) $root['name']) === $sectionName
            ));
            $totalPaise = 0;
            foreach ($chosen as $root) {
                $totalPaise += $root['nature'] === 'income' ? -(int) $root['total'] : (int) $root['total'];
            }

            return [
                'name' => self::SECTION_TITLES[$sectionName],
                'rows' => $this->sectionRows($chosen),
                'total' => Money::toRupees($totalPaise),
            ];
        };

        $directIncome = $section('direct_income');
        $directExpense = $section('direct_expense');
        $indirectIncome = $section('indirect_income');
        $indirectExpense = $section('indirect_expense');

        $openingStockPaise = 0;
        foreach ($this->balancesAt(self::dateOffset($start, -1)) as $ledger) {
            if ($ledger['group'] === 'Stock-in-Hand') {
                $openingStockPaise += (int) $ledger['balancePaise'];
            }
        }
        $closingStockPaise = $this->stockRows($end)['totalPaise'];
        if ($openingStockPaise !== 0) {
            $directExpense['rows'][] = [
                'name' => 'Opening Stock',
                'amount' => Money::toRupees($openingStockPaise),
                'signed' => Money::toRupees($openingStockPaise),
                'ledgers' => [],
                'groups' => [],
            ];
            $directExpense['total'] = Money::toRupees(Money::toPaise($directExpense['total']) + $openingStockPaise);
        }
        if ($closingStockPaise !== 0) {
            $directIncome['rows'][] = [
                'name' => 'Closing Stock',
                'amount' => Money::toRupees($closingStockPaise),
                'signed' => Money::toRupees($closingStockPaise),
                'ledgers' => [],
                'groups' => [],
            ];
            $directIncome['total'] = Money::toRupees(Money::toPaise($directIncome['total']) + $closingStockPaise);
        }

        $grossPaise = Money::toPaise($directIncome['total']) - Money::toPaise($directExpense['total']);
        $netPaise = $grossPaise + Money::toPaise($indirectIncome['total']) - Money::toPaise($indirectExpense['total']);

        return [
            'from' => $start,
            'to' => $end,
            'company' => $company['name'],
            'directIncome' => $directIncome,
            'directExpense' => $directExpense,
            'grossProfit' => Money::toRupees($grossPaise),
            'indirectIncome' => $indirectIncome,
            'indirectExpense' => $indirectExpense,
            'netProfit' => Money::toRupees($netPaise),
            'isLoss' => $netPaise < 0,
            'stock' => [
                'opening' => Money::toRupees($openingStockPaise),
                'closing' => Money::toRupees($closingStockPaise),
            ],
        ];
    }

    private const SECTION_TITLES = [
        'direct_income' => 'Direct Incomes',
        'direct_expense' => 'Direct Expenses',
        'indirect_income' => 'Indirect Incomes',
        'indirect_expense' => 'Indirect Expenses',
    ];

    private function sectionFor(string $groupName): ?string
    {
        $group = $this->catalog->group($groupName);

        return $group['section'] ?? null;
    }

    /** @return array<string, mixed> */
    public function dayBook(?string $date = null, ?string $type = null): array
    {
        $company = $this->getCompany();
        $day = $date ?? gmdate('Y-m-d');
        self::assertIsoDate($day, 'date');
        $clauses = ['v.date = ?'];
        $params = [$day];
        if ($type !== null) {
            $clauses[] = 'v.type = ?';
            $params[] = $this->catalog->resolveVoucherType($type);
        }
        $vouchers = $this->all(
            'SELECT v.*, l.name AS party_name FROM vouchers v
             LEFT JOIN ledgers l ON l.id = v.party_ledger_id
             WHERE ' . implode(' AND ', $clauses) . ' ORDER BY v.id',
            $params
        );
        $debitTotal = 0;
        $creditTotal = 0;
        $rows = [];
        foreach ($vouchers as $voucher) {
            $lines = $this->all(
                'SELECT vl.amount_paise, l.name FROM voucher_lines vl JOIN ledgers l ON l.id = vl.ledger_id
                 WHERE vl.voucher_id = ? ORDER BY vl.position',
                [(int) $voucher['id']]
            );
            $debit = [];
            $credit = [];
            foreach ($lines as $line) {
                $paise = (int) $line['amount_paise'];
                if ($paise > 0) {
                    $debit[] = ['ledger' => $line['name'], 'amount' => Money::toRupees($paise)];
                    $debitTotal += $paise;
                } elseif ($paise < 0) {
                    $credit[] = ['ledger' => $line['name'], 'amount' => Money::toRupees(-$paise)];
                    $creditTotal -= $paise;
                }
            }
            $rows[] = [
                'id' => (int) $voucher['id'],
                'type' => $voucher['type'],
                'typeName' => $this->catalog->voucherTypeName((string) $voucher['type']),
                'number' => $voucher['number'],
                'narration' => $voucher['narration'],
                'party' => $voucher['party_name'],
                'total' => Money::toRupees((int) $voucher['total_paise']),
                'debitLedgers' => $debit,
                'creditLedgers' => $credit,
            ];
        }
        $known = $this->one('SELECT COUNT(*) AS n FROM vouchers WHERE date = ?', [$day]);

        return [
            'date' => $day,
            'company' => $company['name'],
            'vouchers' => $rows,
            'totals' => [
                'debit' => Money::toRupees($debitTotal),
                'credit' => Money::toRupees($creditTotal),
            ],
            'count' => (int) ($known['n'] ?? 0),
        ];
    }

    /** @return array<string, mixed> */
    public function ledgerReport(int $ledgerId, ?string $from = null, ?string $to = null): array
    {
        $company = $this->getCompany();
        $ledger = $this->getLedger($ledgerId);
        $start = $from ?? $company['financialYearStart'];
        $end = $to ?? $company['financialYearEnd'];
        $before = $this->one(
            'SELECT COALESCE(SUM(vl.amount_paise),0) AS total FROM voucher_lines vl
             JOIN vouchers v ON v.id = vl.voucher_id WHERE vl.ledger_id = ? AND v.date < ?',
            [$ledgerId, $start]
        );
        $openingPaise = (int) $ledger['openingPaise'] + (int) ($before['total'] ?? 0);
        $rows = $this->all(
            'SELECT v.id, v.date, v.type, v.number, v.narration, vl.amount_paise, vl.bill_ref
             FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id
             WHERE vl.ledger_id = ? AND v.date >= ? AND v.date <= ?
             ORDER BY v.date, v.id',
            [$ledgerId, $start, $end]
        );
        $running = $openingPaise;
        $entries = [];
        $debitTotal = 0;
        $creditTotal = 0;
        foreach ($rows as $row) {
            $amount = (int) $row['amount_paise'];
            $running += $amount;
            $others = array_map(
                static fn (array $line): string => (string) $line['name'],
                $this->all(
                    'SELECT l.name FROM voucher_lines vl JOIN ledgers l ON l.id = vl.ledger_id
                     WHERE vl.voucher_id = ? AND vl.ledger_id <> ?',
                    [(int) $row['id'], $ledgerId]
                )
            );
            if ($amount > 0) {
                $debitTotal += $amount;
            } else {
                $creditTotal -= $amount;
            }
            $entries[] = [
                'voucherId' => (int) $row['id'],
                'date' => $row['date'],
                'type' => $this->catalog->voucherTypeName((string) $row['type']),
                'number' => $row['number'],
                'particulars' => implode(', ', $others),
                'narration' => $row['narration'],
                'billRef' => $row['bill_ref'],
                'debit' => $amount > 0 ? Money::toRupees($amount) : 0,
                'credit' => $amount < 0 ? Money::toRupees(-$amount) : 0,
                'balance' => Money::toRupees($running),
            ];
        }

        return [
            'ledger' => ['id' => $ledger['id'], 'name' => $ledger['name'], 'group' => $ledger['group']],
            'from' => $start,
            'to' => $end,
            'opening' => Money::toRupees($openingPaise),
            'openingType' => $openingPaise >= 0 ? 'Dr' : 'Cr',
            'entries' => $entries,
            'totals' => [
                'debit' => Money::toRupees($debitTotal),
                'credit' => Money::toRupees($creditTotal),
            ],
            'closing' => Money::toRupees($running),
            'closingType' => $running >= 0 ? 'Dr' : 'Cr',
        ];
    }

    /** @return array<string, mixed> */
    public function outstanding(?string $asOf = null, string $type = 'receivable'): array
    {
        $company = $this->getCompany();
        $date = $asOf ?? $company['financialYearEnd'];
        $groupName = $type === 'payable' ? 'Sundry Creditors' : 'Sundry Debtors';
        $balances = array_values(array_filter(
            $this->balancesAt($date),
            static fn (array $ledger): bool => $ledger['group'] === $groupName
        ));
        $buckets = ['current' => 0, 'd30' => 0, 'd60' => 0, 'd90' => 0, 'older' => 0];
        $totalPaise = 0;
        $parties = [];
        $asOfTs = strtotime($date . 'T00:00:00Z');
        foreach ($balances as $ledger) {
            $balance = $type === 'payable' ? -(int) $ledger['balancePaise'] : (int) $ledger['balancePaise'];
            if ($balance === 0) {
                continue;
            }
            $totalPaise += $balance;
            $billRows = $this->all(
                'SELECT v.date, v.number, v.type, vl.amount_paise, vl.bill_ref
                 FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id
                 WHERE vl.ledger_id = ? AND v.date <= ? ORDER BY v.date',
                [(int) $ledger['id'], $date]
            );
            if ((int) $ledger['openingPaise'] !== 0) {
                array_unshift($billRows, [
                    'date' => $company['financialYearStart'],
                    'number' => 'Opening balance',
                    'type' => 'OPENING',
                    'amount_paise' => (int) $ledger['openingPaise'],
                    'bill_ref' => null,
                ]);
            }
            $bills = [];
            foreach ($billRows as $row) {
                $signed = $type === 'payable' ? -(int) $row['amount_paise'] : (int) $row['amount_paise'];
                $ageDays = max(0, (int) round(($asOfTs - strtotime($row['date'] . 'T00:00:00Z')) / 86400));
                $bucket = match (true) {
                    $ageDays <= 30 => 'current',
                    $ageDays <= 60 => 'd30',
                    $ageDays <= 90 => 'd60',
                    $ageDays <= 180 => 'd90',
                    default => 'older',
                };
                $buckets[$bucket] += $signed;
                $bills[] = [
                    'date' => $row['date'],
                    'number' => $row['number'],
                    'type' => $row['type'] === 'OPENING'
                        ? 'Opening'
                        : $this->catalog->voucherTypeName((string) $row['type']),
                    'billRef' => $row['bill_ref'],
                    'amount' => Money::toRupees($signed),
                    'ageDays' => $ageDays,
                    'bucket' => $bucket,
                ];
            }
            $parties[] = [
                'id' => (int) $ledger['id'],
                'name' => $ledger['name'],
                'balance' => Money::toRupees($balance),
                'creditDays' => $ledger['creditDays'],
                'bills' => $bills,
            ];
        }
        usort($parties, static fn (array $a, array $b): int => abs((float) $b['balance']) <=> abs((float) $a['balance']));

        return [
            'asOf' => $date,
            'type' => $type,
            'group' => $groupName,
            'parties' => $parties,
            'total' => Money::toRupees($totalPaise),
            'ageing' => [
                'current' => Money::toRupees($buckets['current']),
                'd30' => Money::toRupees($buckets['d30']),
                'd60' => Money::toRupees($buckets['d60']),
                'd90' => Money::toRupees($buckets['d90']),
                'older' => Money::toRupees($buckets['older']),
            ],
        ];
    }

    /** @return array<string, mixed> */
    public function gstSummary(?string $from = null, ?string $to = null): array
    {
        $company = $this->getCompany();
        $start = $from ?? $company['financialYearStart'];
        $end = $to ?? $company['financialYearEnd'];
        $balances = array_values(array_filter(
            $this->balancesIn($start, $end),
            static fn (array $ledger): bool => $ledger['group'] === 'Duties & Taxes' && (int) $ledger['movementPaise'] !== 0
        ));
        $lines = array_map(static function (array $ledger): array {
            $movement = (int) $ledger['movementPaise'];
            $outputPaise = -$movement;

            return [
                'ledger' => $ledger['name'],
                'tax' => self::taxHead((string) $ledger['name']),
                'kind' => $outputPaise > 0 ? 'output' : 'input',
                'amount' => Money::toRupees(abs($outputPaise)),
                'signed' => Money::toRupees($movement),
            ];
        }, $balances);
        $outputPaise = 0;
        $inputPaise = 0;
        foreach ($balances as $ledger) {
            $movement = (int) $ledger['movementPaise'];
            if ($movement < 0) {
                $outputPaise -= $movement;
            } elseif ($movement > 0) {
                $inputPaise += $movement;
            }
        }

        return [
            'from' => $start,
            'to' => $end,
            'lines' => $lines,
            'outputTotal' => Money::toRupees($outputPaise),
            'inputTotal' => Money::toRupees($inputPaise),
            'netPayable' => Money::toRupees($outputPaise - $inputPaise),
        ];
    }

    private static function taxHead(string $name): string
    {
        $upper = strtoupper($name);

        return match (true) {
            str_contains($upper, 'CGST') => 'CGST',
            str_contains($upper, 'SGST'), str_contains($upper, 'UTGST') => 'SGST',
            str_contains($upper, 'IGST') => 'IGST',
            str_contains($upper, 'CESS') => 'CESS',
            default => 'Other',
        };
    }

    /**
     * Inventory movement rows in paise; the single owner of stock valuation.
     *
     * @return array{rows: array<int, array<string, mixed>>, totalPaise: int}
     */
    private function stockRows(string $asOf): array
    {
        $items = $this->all('SELECT * FROM stock_items ORDER BY name COLLATE NOCASE');
        $movement = $this->all(
            'SELECT vi.stock_item_id AS itemId,
                    COALESCE(SUM(CASE WHEN vi.qty_milli > 0 THEN vi.qty_milli ELSE 0 END),0) AS inQty,
                    COALESCE(SUM(CASE WHEN vi.qty_milli < 0 THEN -vi.qty_milli ELSE 0 END),0) AS outQty,
                    COALESCE(SUM(CASE WHEN vi.qty_milli > 0 THEN vi.amount_paise ELSE 0 END),0) AS inValue
             FROM voucher_inventory vi JOIN vouchers v ON v.id = vi.voucher_id
             WHERE v.date <= ? GROUP BY vi.stock_item_id',
            [$asOf]
        );
        $map = [];
        foreach ($movement as $row) {
            $map[(int) $row['itemId']] = $row;
        }
        $totalPaise = 0;
        $rows = [];
        foreach ($items as $item) {
            $entry = $map[(int) $item['id']] ?? null;
            $openQty = (int) $item['opening_qty_milli'];
            $openValue = (int) $item['opening_value_paise'];
            $inQty = $entry === null ? 0 : (int) $entry['inQty'];
            $outQty = $entry === null ? 0 : (int) $entry['outQty'];
            $inValue = $entry === null ? 0 : (int) $entry['inValue'];
            $closingQty = $openQty + $inQty - $outQty;
            $denominator = $openQty + $inQty;
            $averageRate = $denominator === 0 ? 0 : (int) self::jsRound((($openValue + $inValue) * 1000) / $denominator);
            $closingValue = (int) self::jsRound(($closingQty * $averageRate) / 1000);
            $totalPaise += $closingValue;
            $rows[] = [
                'id' => (int) $item['id'],
                'name' => $item['name'],
                'group' => $item['stock_group'],
                'unit' => $item['unit'],
                'gstRate' => (float) $item['gst_rate'],
                'openingQty' => $openQty,
                'inwardQty' => $inQty,
                'outwardQty' => $outQty,
                'closingQty' => $closingQty,
                'averageRate' => $averageRate,
                'closingValue' => $closingValue,
            ];
        }

        return ['rows' => $rows, 'totalPaise' => $totalPaise];
    }

    /** @return array<string, mixed> */
    public function stockSummary(?string $asOf = null): array
    {
        $company = $this->getCompany();
        $date = $asOf ?? $company['financialYearEnd'];
        self::assertIsoDate($date, 'asOf');
        $stock = $this->stockRows($date);

        return [
            'asOf' => $date,
            'company' => $company['name'],
            'rows' => array_map(static fn (array $row): array => [
                'id' => $row['id'],
                'name' => $row['name'],
                'group' => $row['group'],
                'unit' => $row['unit'],
                'gstRate' => $row['gstRate'],
                'openingQty' => $row['openingQty'] / 1000,
                'inwardQty' => $row['inwardQty'] / 1000,
                'outwardQty' => $row['outwardQty'] / 1000,
                'closingQty' => $row['closingQty'] / 1000,
                'rate' => Money::toRupees($row['averageRate']),
                'value' => Money::toRupees($row['closingValue']),
            ], $stock['rows']),
            'totalValue' => Money::toRupees($stock['totalPaise']),
        ];
    }

    /** @return array<string, mixed> */
    public function statistics(): array
    {
        $company = $this->getCompany();
        $balances = $this->balancesAt((string) $company['financialYearEnd']);
        $byGroup = static function (string $name) use ($balances): int {
            $total = 0;
            foreach ($balances as $ledger) {
                if ($ledger['group'] === $name) {
                    $total += (int) $ledger['balancePaise'];
                }
            }

            return $total;
        };
        $profitAndLoss = $this->profitLoss();

        return [
            'company' => $company,
            'counts' => [
                'ledgers' => $this->count('ledgers'),
                'vouchers' => $this->count('vouchers'),
                'groups' => $this->count('groups'),
                'stockItems' => $this->count('stock_items'),
            ],
            'cashInHand' => Money::toRupees($byGroup('Cash-in-Hand')),
            'bankBalance' => Money::toRupees($byGroup('Bank Accounts')),
            'debtors' => Money::toRupees($byGroup('Sundry Debtors')),
            'creditors' => Money::toRupees(-$byGroup('Sundry Creditors')),
            'netProfit' => Money::toRupees(Money::toPaise($profitAndLoss['netProfit'])),
        ];
    }

    /** @return array<int, array<string, mixed>> */
    public function stockItems(): array
    {
        return $this->all('SELECT * FROM stock_items ORDER BY name COLLATE NOCASE');
    }

    // ------------------------------------------------------------------ utils

    private function count(string $table): int
    {
        $allowed = ['ledgers', 'vouchers', 'groups', 'stock_items'];
        if (!in_array($table, $allowed, true)) {
            throw new \InvalidArgumentException("Cannot count {$table}");
        }
        $row = $this->one("SELECT COUNT(*) AS n FROM {$table}");

        return (int) ($row['n'] ?? 0);
    }

    /** @return array<string, mixed>|null */
    /**
     * Tally's import envelope, rendered from the book.
     *
     * Kept line-for-line compatible with `src/app.js#exportXml`: the same tags
     * in the same order, because "export from here, import into Tally Prime"
     * only works if the shape is right.
     */
    public function exportXml(
        ?string $from = null,
        ?string $to = null,
        bool $masters = true,
        bool $vouchers = true
    ): string {
        $company = $this->getCompany();
        $start = $from ?? $company['financialYearStart'];
        $end = $to ?? $company['financialYearEnd'];
        $parts = [];
        $parts[] = '<?xml version="1.0" encoding="UTF-8"?>';
        $parts[] = '<ENVELOPE>';
        $parts[] = ' <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>';
        $parts[] = ' <BODY>';
        $parts[] = '  <IMPORTDATA>';
        $parts[] = '   <REQUESTDESC>';
        $parts[] = '    <REPORTNAME>Vouchers</REPORTNAME>';
        $parts[] = '    <STATICVARIABLES>';
        $parts[] = '     <SVCURRENTCOMPANY>' . Xml::escape((string) $company['name']) . '</SVCURRENTCOMPANY>';
        $parts[] = '     <SVFROMDATE>' . str_replace('-', '', $start) . '</SVFROMDATE>';
        $parts[] = '     <SVTODATE>' . str_replace('-', '', $end) . '</SVTODATE>';
        $parts[] = '    </STATICVARIABLES>';
        $parts[] = '   </REQUESTDESC>';
        $parts[] = '   <REQUESTDATA>';

        if ($masters) {
            foreach ($this->all('SELECT * FROM groups ORDER BY parent IS NOT NULL, name') as $group) {
                if ((int) $group['predefined'] === 1) {
                    continue;
                }
                $parts[] = '    <TALLYMESSAGE><GROUP NAME="' . Xml::escape((string) $group['name']) . '" ACTION="Create">';
                $parts[] = '     <NAME>' . Xml::escape((string) $group['name']) . '</NAME>';
                if ($group['parent'] !== null) {
                    $parts[] = '     <PARENT>' . Xml::escape((string) $group['parent']) . '</PARENT>';
                }
                $parts[] = '    </GROUP></TALLYMESSAGE>';
            }
            foreach ($this->ledgerRows() as $ledger) {
                $parts[] = '    <TALLYMESSAGE><LEDGER NAME="' . Xml::escape((string) $ledger['name']) . '" ACTION="Create">';
                $parts[] = '     <NAME>' . Xml::escape((string) $ledger['name']) . '</NAME>';
                $parts[] = '     <PARENT>' . Xml::escape((string) $ledger['group']) . '</PARENT>';
                if ((int) $ledger['openingPaise'] !== 0) {
                    $parts[] = '     <OPENINGBALANCE>' . Xml::amount((int) $ledger['openingPaise']) . '</OPENINGBALANCE>';
                }
                if ($ledger['gstin'] !== null) {
                    $parts[] = '     <PARTYGSTIN>' . Xml::escape((string) $ledger['gstin']) . '</PARTYGSTIN>';
                }
                $parts[] = '     <ISBILLWISEON>Yes</ISBILLWISEON>';
                $parts[] = '    </LEDGER></TALLYMESSAGE>';
            }
        }

        if ($vouchers) {
            $ids = array_map(
                static fn (array $row): int => (int) $row['id'],
                $this->all(
                    'SELECT id FROM vouchers WHERE date BETWEEN ? AND ? ORDER BY date, id',
                    [$start, $end]
                )
            );
            foreach ($ids as $id) {
                $voucher = $this->getVoucher($id);
                $parts[] = '    <TALLYMESSAGE><VOUCHER VCHTYPE="' . Xml::escape((string) $voucher['typeName']) . '" ACTION="Create">';
                $parts[] = '     <DATE>' . str_replace('-', '', (string) $voucher['date']) . '</DATE>';
                $parts[] = '     <VOUCHERTYPENAME>' . Xml::escape((string) $voucher['typeName']) . '</VOUCHERTYPENAME>';
                $parts[] = '     <VOUCHERNUMBER>' . Xml::escape((string) $voucher['number']) . '</VOUCHERNUMBER>';
                if ($voucher['narration'] !== null) {
                    $parts[] = '     <NARRATION>' . Xml::escape((string) $voucher['narration']) . '</NARRATION>';
                }
                if ($voucher['party'] !== null) {
                    $parts[] = '     <PARTYLEDGERNAME>' . Xml::escape((string) $voucher['party']['name']) . '</PARTYLEDGERNAME>';
                }
                foreach ($voucher['lines'] as $line) {
                    $isDebit = (float) $line['debit'] > 0;
                    $parts[] = '     <ALLLEDGERENTRIES.LIST>';
                    $parts[] = '      <LEDGERNAME>' . Xml::escape((string) $line['ledger']) . '</LEDGERNAME>';
                    $parts[] = '      <ISDEEMEDPOSITIVE>' . ($isDebit ? 'Yes' : 'No') . '</ISDEEMEDPOSITIVE>';
                    $magnitude = $isDebit ? (float) $line['debit'] : (float) $line['credit'];
                    $signed = $isDebit ? -$magnitude : $magnitude;
                    $parts[] = '      <AMOUNT>' . number_format($signed, 2, '.', '') . '</AMOUNT>';
                    if ($line['billRef'] !== null) {
                        $parts[] = '      <BILLALLOCATIONS.LIST>';
                        $parts[] = '       <NAME>' . Xml::escape((string) $line['billRef']) . '</NAME>';
                        $parts[] = '       <BILLTYPE>New Ref</BILLTYPE>';
                        $parts[] = '       <AMOUNT>' . number_format($signed, 2, '.', '') . '</AMOUNT>';
                        $parts[] = '      </BILLALLOCATIONS.LIST>';
                    }
                    $parts[] = '     </ALLLEDGERENTRIES.LIST>';
                }
                $parts[] = '    </VOUCHER></TALLYMESSAGE>';
            }
        }

        $parts[] = '   </REQUESTDATA>';
        $parts[] = '  </IMPORTDATA>';
        $parts[] = ' </BODY>';
        $parts[] = '</ENVELOPE>';

        return implode("\n", $parts) . "\n";
    }

    /**
     * Import masters and vouchers from a Tally envelope.
     *
     * Same rules as `src/app.js#importXml`: existing ledgers are skipped rather
     * than overwritten, an unknown parent group falls back to Suspense A/c, and
     * a dry run executes the real writes inside a transaction that is rolled
     * back — a preview that does not try the write cannot report duplicates.
     *
     * @return array<string, mixed>
     */
    public function importXml(string $xml, bool $createMissingGroups = true, bool $dryRun = false): array
    {
        try {
            $document = Xml::parse($xml);
        } catch (\RuntimeException $error) {
            throw new TallyCraftError('INVALID_XML', 'Could not parse XML: ' . $error->getMessage());
        }
        $summary = [
            'groups' => 0,
            'ledgers' => 0,
            'vouchers' => 0,
            'skipped' => 0,
            'warnings' => [],
        ];

        $importLedger = function (array $node) use (&$summary, $createMissingGroups): void {
            $name = Xml::childText($node, 'NAME');
            $parent = Xml::childText($node, 'PARENT');
            if ($name === null || $name === '') {
                $summary['skipped'] += 1;

                return;
            }
            $groupRow = $this->one('SELECT id FROM groups WHERE name = ? COLLATE NOCASE', [$parent ?? '']);
            if ($groupRow === null) {
                $candidate = $parent !== null && $this->catalog->group('Sundry ' . $parent) !== null
                    ? 'Sundry ' . $parent
                    : 'Suspense A/c';
                if (!$createMissingGroups) {
                    $summary['warnings'][] = sprintf(
                        'Group "%s" for ledger %s is unknown; used %s',
                        $parent ?? '(none)',
                        $name,
                        $candidate
                    );
                }
                $groupRow = $this->one('SELECT id FROM groups WHERE name = ?', [$candidate]);
            }
            $openingText = Xml::childText($node, 'OPENINGBALANCE');
            $openingPaise = $openingText === null ? 0 : (int) round(((float) $openingText) * 100);
            $existing = $this->one('SELECT id FROM ledgers WHERE name = ? COLLATE NOCASE', [$name]);
            $gstin = Xml::childText($node, 'PARTYGSTIN') ?? Xml::childText($node, 'GSTIN');
            try {
                if ($existing === null) {
                    $groupName = (string) $this->one('SELECT name FROM groups WHERE id = ?', [(int) $groupRow['id']])['name'];
                    $this->createLedger([
                        'name' => $name,
                        'group' => $groupName,
                        'opening' => $openingPaise / 100,
                        'openingType' => $openingPaise >= 0 ? 'Dr' : 'Cr',
                        'gstin' => $gstin,
                    ]);
                    $summary['ledgers'] += 1;
                } else {
                    $summary['skipped'] += 1;
                }
            } catch (TallyCraftError $error) {
                $summary['warnings'][] = 'Ledger ' . $name . ': ' . $error->getMessage();
                $summary['skipped'] += 1;
            }
        };

        $importVoucher = function (array $node) use (&$summary): void {
            $typeName = $node['attributes']['VCHTYPE']
                ?? Xml::childText($node, 'VOUCHERTYPENAME')
                ?? Xml::childText($node, 'VCHTYPE');
            $dateText = Xml::childText($node, 'DATE') ?? Xml::childText($node, 'VOUCHERDATE');
            if ($typeName === null || $dateText === null) {
                $summary['skipped'] += 1;

                return;
            }
            $date = strlen($dateText) === 8
                ? substr($dateText, 0, 4) . '-' . substr($dateText, 4, 2) . '-' . substr($dateText, 6, 2)
                : $dateText;
            $lines = [];
            $entries = array_merge(
                Xml::childrenNamed($node, 'ALLLEDGERENTRIES.LIST'),
                Xml::childrenNamed($node, 'LEDGERENTRIES.LIST')
            );
            foreach ($entries as $entry) {
                $ledgerName = Xml::childText($entry, 'LEDGERNAME');
                $amountText = Xml::childText($entry, 'AMOUNT');
                if ($ledgerName === null || $amountText === null) {
                    continue;
                }
                $raw = (float) $amountText;
                if (!is_finite($raw)) {
                    continue;
                }
                // Tally marks a debit with ISDEEMEDPOSITIVE=Yes and usually
                // writes the amount negative; trust the flag, then the sign.
                $deemedPositive = strtolower(Xml::childText($entry, 'ISDEEMEDPOSITIVE') ?? 'No') === 'yes';
                $magnitude = abs((int) round($raw * 100));
                $paise = $deemedPositive ? $magnitude : -$magnitude;
                $billAllocations = Xml::childrenNamed($entry, 'BILLALLOCATIONS.LIST');
                $billRef = $billAllocations === [] ? null : Xml::childText($billAllocations[0], 'NAME');
                $lines[] = ['ledger' => $ledgerName, 'amount' => $paise / 100, 'billRef' => $billRef];
            }
            if (count($lines) < 2) {
                $summary['skipped'] += 1;
                $summary['warnings'][] = sprintf(
                    'Voucher %s has no readable entries',
                    Xml::childText($node, 'VOUCHERNUMBER') ?? '?'
                );

                return;
            }
            try {
                $input = [
                    'type' => $typeName,
                    'date' => $date,
                    'lines' => $lines,
                ];
                $number = Xml::childText($node, 'VOUCHERNUMBER');
                if ($number !== null) {
                    $input['number'] = $number;
                }
                $narration = Xml::childText($node, 'NARRATION');
                if ($narration !== null) {
                    $input['narration'] = $narration;
                }
                $this->createVoucher($input);
                $summary['vouchers'] += 1;
            } catch (TallyCraftError $error) {
                $summary['skipped'] += 1;
                $next = $error->details['next'] ?? null;
                $summary['warnings'][] = sprintf(
                    'Voucher %s: %s%s',
                    Xml::childText($node, 'VOUCHERNUMBER') ?? '?',
                    $error->getMessage(),
                    $next === null ? '' : sprintf(' (next available %s)', $next)
                );
            }
        };

        $result = $this->transaction(function () use ($document, $importLedger, $importVoucher): array {
            $summary = ['groups' => 0, 'ledgers' => 0, 'vouchers' => 0, 'skipped' => 0, 'warnings' => []];
            foreach (Xml::findAll($document, ['LEDGER']) as $node) {
                $importLedger($node);
            }
            foreach (Xml::findAll($document, ['VOUCHER']) as $node) {
                $importVoucher($node);
            }

            return $summary;
        }, $dryRun);

        // `$summary` is captured by reference in the closures, so it already
        // holds the counts; the transaction only had to decide commit/rollback.
        return $dryRun ? $summary + ['dryRun' => true] : $summary;
    }

    /**
     * Run a unit of work atomically, nesting safely.
     *
     * Import wraps every voucher in one transaction, and `createVoucher` wants
     * its own: SQLite refuses `BEGIN` inside `BEGIN`, so the inner call becomes
     * a savepoint instead. That is also what makes a dry run possible — the
     * outer call rolls back and nothing written by the inner calls survives.
     */
    private function transaction(callable $work, bool $rollback = false): mixed
    {
        $nested = $this->db->inTransaction();
        $savepoint = 'tc_savepoint_' . $this->savepointDepth;
        if ($nested) {
            $this->db->exec('SAVEPOINT ' . $savepoint);
        } else {
            $this->db->beginTransaction();
        }
        $this->savepointDepth += 1;
        try {
            $result = $work();
            $this->savepointDepth -= 1;
            if ($nested) {
                $this->db->exec('RELEASE ' . $savepoint);
            } elseif ($rollback) {
                $this->db->rollBack();
            } else {
                $this->db->commit();
            }

            return $result;
        } catch (\Throwable $error) {
            $this->savepointDepth -= 1;
            if ($nested) {
                $this->db->exec('ROLLBACK TO ' . $savepoint);
                $this->db->exec('RELEASE ' . $savepoint);
            } elseif ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error;
        }
    }

    private function one(string $sql, array $params = []): ?array
    {
        $statement = $this->db->prepare($sql);
        $statement->execute($params);
        $row = $statement->fetch(PDO::FETCH_ASSOC);

        return $row === false ? null : $row;
    }

    /** @return array<int, array<string, mixed>> */
    private function all(string $sql, array $params = []): array
    {
        $statement = $this->db->prepare($sql);
        $statement->execute($params);

        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    private function run(string $sql, array $params = []): void
    {
        $this->db->prepare($sql)->execute($params);
    }

    /** @param mixed $identifier */
    private function findLedger(mixed $identifier): array
    {
        if (is_int($identifier) || (is_string($identifier) && ctype_digit($identifier))) {
            return $this->getLedger((int) $identifier);
        }
        if (is_string($identifier) && trim($identifier) !== '') {
            $row = $this->one(
                'SELECT l.*, g.name AS group_name, g.nature, g.natural
                 FROM ledgers l JOIN groups g ON g.id = l.group_id WHERE l.name = ? COLLATE NOCASE',
                [trim($identifier)]
            );
            if ($row !== null) {
                return $this->mapLedger($row);
            }
        }
        throw new TallyCraftError('UNKNOWN_LEDGER', 'No ledger matching ' . json_encode($identifier));
    }

    /** "1,23,456.78" | 1234.5 | "500 Cr" -> signed paise (debit positive). */
    private function parseSignedAmount(mixed $value, ?string $direction): int
    {
        if (is_int($value) || is_float($value)) {
            if (!is_finite((float) $value)) {
                throw new TallyCraftError('INVALID_AMOUNT', 'Amount must be a finite number');
            }

            return Money::toPaise($value);
        }
        if (!is_string($value)) {
            throw new TallyCraftError('INVALID_AMOUNT', 'Amount must be a number or numeric string');
        }
        $trimmed = trim($value);
        $suffix = null;
        if (preg_match('/\s*(dr|cr)$/i', $trimmed, $match) === 1) {
            $suffix = strtolower($match[1]);
            $trimmed = substr($trimmed, 0, (int) strrpos($trimmed, $match[0]));
        }
        $magnitude = ltrim($trimmed, '=');
        $parsed = self::parseAmount($magnitude);
        if ($parsed === null) {
            throw new TallyCraftError('INVALID_AMOUNT', sprintf('Cannot read amount "%s"', $value));
        }
        $sign = $suffix !== null ? ($suffix === 'cr' ? 'Cr' : 'Dr') : $direction;
        $absolute = abs($parsed);
        if ($sign === null) {
            return $parsed;
        }

        return $sign === 'Cr' ? -$absolute : $absolute;
    }

    /** Tally-style amount text to paise, or null when ambiguous. */
    private static function parseAmount(string $text): ?int
    {
        $trimmed = trim($text);
        if ($trimmed === '' || preg_match('/^[-+]?(?:\d{1,3}(?:,\d{2,3})*|\d+)(?:\.(\d{0,2}))?$/', $trimmed) !== 1) {
            return null;
        }
        $negative = str_starts_with($trimmed, '-');
        $unsigned = str_replace(',', '', ltrim($trimmed, '+-'));
        [$whole, $fraction] = array_pad(explode('.', $unsigned, 2), 2, '');
        $paise = ((int) $whole) * 100 + (int) str_pad($fraction, 2, '0');
        if (!is_int($paise)) {
            return null;
        }

        return $negative ? -$paise : $paise;
    }

    public static function normaliseName(mixed $value): string
    {
        if (!is_string($value)) {
            return '';
        }

        return trim(preg_replace('/\s+/', ' ', $value) ?? '');
    }

    private static function assertIsoDate(string $value, string $field = 'date'): string
    {
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) !== 1) {
            throw new TallyCraftError('INVALID_DATE', "{$field} must be an ISO date (YYYY-MM-DD)");
        }
        [$year, $month, $day] = array_map('intval', explode('-', $value));
        if (!checkdate($month, $day, $year)) {
            throw new TallyCraftError('INVALID_DATE', "{$field} is not a real date");
        }

        return $value;
    }

    private static function dateOffset(string $isoDate, int $days): string
    {
        $timestamp = strtotime($isoDate . 'T00:00:00Z');

        return gmdate('Y-m-d', (int) $timestamp + $days * 86400);
    }

    /** Flip the sign of a rupee amount without going through paise twice. */
    private static function negate(int|float $rupees): int|float
    {
        return $rupees === 0 ? 0 : -$rupees;
    }

    /** JavaScript's Math.round: half away from zero is wrong, half *up* is right. */
    public static function jsRound(float $value): float
    {
        return floor($value + 0.5);
    }

    private static function now(): string
    {
        return gmdate('Y-m-d\TH:i:s') . '.000Z';
    }
}
