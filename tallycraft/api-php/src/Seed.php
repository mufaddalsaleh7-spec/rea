<?php

declare(strict_types=1);

namespace TallyCraft;

/**
 * Load the demo book.
 *
 * The book itself is generated from the Node seeder (`scripts/export-php-data.mjs`)
 * instead of being retyped here: two hand-written demo companies drift, and a
 * drifting demo makes every parity comparison meaningless. Loading is
 * idempotent — a reset replaces the book, a load on a seeded database is a
 * no-op unless `force` is set, matching `seed()` in `src/seed.js`.
 */
final class Seed
{
    public function __construct(
        private readonly \PDO $db,
        private readonly string $path,
        private readonly Catalog $catalog,
    ) {
    }

    /** @return array<string, mixed> */
    public function load(bool $force = false): array
    {
        $existing = $this->db->query('SELECT COUNT(*) AS n FROM companies')->fetchColumn();
        if ((int) $existing > 0 && !$force) {
            $name = $this->db->query('SELECT name FROM companies ORDER BY id LIMIT 1')->fetchColumn();

            return [
                'created' => false,
                'company' => ['name' => $name],
                'counts' => $this->counts(),
            ];
        }

        $data = $this->read();

        $this->db->beginTransaction();
        try {
            $this->truncate();
            $this->insertCompany($data['company']);
            $this->insertStock($data);
            $this->insertLedgers($data['ledgers']);
            $this->insertVouchers($data['vouchers']);
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }

        return [
            'created' => true,
            'company' => ['name' => $data['company']['name']],
            'counts' => $this->counts(),
        ];
    }

    /** @return array<string, mixed> */
    private function read(): array
    {
        $raw = @file_get_contents($this->path);
        if ($raw === false) {
            throw new TallyCraftError(
                'SEED_MISSING',
                'No seed data. Run `npm run export:php` to generate api-php/data/seed.json.'
            );
        }

        return json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    }

    /** @return array<string, int> */
    public function counts(): array
    {
        return [
            'companies' => (int) $this->db->query('SELECT COUNT(*) FROM companies')->fetchColumn(),
            'ledgers' => (int) $this->db->query('SELECT COUNT(*) FROM ledgers')->fetchColumn(),
            'vouchers' => (int) $this->db->query('SELECT COUNT(*) FROM vouchers')->fetchColumn(),
            'stockItems' => (int) $this->db->query('SELECT COUNT(*) FROM stock_items')->fetchColumn(),
        ];
    }

    private function truncate(): void
    {
        // Order matters: children first, or the foreign keys refuse.
        foreach (['voucher_inventory', 'voucher_lines', 'vouchers', 'ledgers', 'stock_items', 'stock_groups', 'companies'] as $table) {
            $this->db->exec("DELETE FROM {$table}");
        }
    }

    /** @param array<string, mixed> $company */
    private function insertCompany(array $company): void
    {
        $statement = $this->db->prepare(
            'INSERT INTO companies (name, mailing_name, address, gstin, state, financial_year_start, financial_year_end, base_currency, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $statement->execute([
            $company['name'],
            $company['mailingName'] ?? null,
            $company['address'] ?? null,
            $company['gstin'] ?? null,
            $company['state'] ?? null,
            $company['financialYearStart'],
            $company['financialYearEnd'],
            $company['baseCurrency'] ?? 'INR',
            gmdate('Y-m-d\TH:i:s\Z'),
        ]);
    }

    /** @param array<string, mixed> $data */
    private function insertStock(array $data): void
    {
        $group = $this->db->prepare('INSERT OR IGNORE INTO stock_groups (name) VALUES (?)');
        foreach ($data['stockGroups'] ?? [] as $name) {
            $group->execute([$name]);
        }
        $item = $this->db->prepare(
            'INSERT INTO stock_items (name, stock_group, unit, opening_qty_milli, opening_value_paise, gst_rate, hsn)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($data['stockItems'] ?? [] as $row) {
            $item->execute([
                $row['name'],
                $row['group'] ?? null,
                $row['unit'] ?? 'Nos',
                (int) ($row['openingQtyMilli'] ?? 0),
                (int) ($row['openingValuePaise'] ?? 0),
                (float) ($row['gstRate'] ?? 0),
                $row['hsn'] ?? null,
            ]);
        }
    }

    /** @param array<int, array<string, mixed>> $ledgers */
    private function insertLedgers(array $ledgers): void
    {
        $group = $this->db->prepare('SELECT id, natural FROM groups WHERE name = ? COLLATE NOCASE');
        $insert = $this->db->prepare(
            'INSERT INTO ledgers (name, group_id, opening_paise, opening_dated, gstin, party_type,
                                  mailing_name, address, phone, credit_days, is_active, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)'
        );
        foreach ($ledgers as $ledger) {
            $group->execute([$ledger['group']]);
            $row = $group->fetch();
            if ($row === false) {
                throw new TallyCraftError('UNKNOWN_GROUP', sprintf('Seed uses unknown group "%s"', $ledger['group']));
            }
            $insert->execute([
                $ledger['name'],
                (int) $row['id'],
                Money::toPaise($ledger['opening'] ?? 0),
                $ledger['openingDated'] ?? null,
                $ledger['gstin'] ?? null,
                $ledger['partyType'] ?? null,
                $ledger['mailingName'] ?? $ledger['name'],
                $ledger['address'] ?? null,
                $ledger['phone'] ?? null,
                isset($ledger['creditDays']) ? (int) $ledger['creditDays'] : null,
                gmdate('Y-m-d\TH:i:s\Z'),
            ]);
        }
    }

    /** @param array<int, array<string, mixed>> $vouchers */
    private function insertVouchers(array $vouchers): void
    {
        $ledger = $this->db->prepare('SELECT id FROM ledgers WHERE name = ? COLLATE NOCASE');
        $item = $this->db->prepare('SELECT id FROM stock_items WHERE name = ? COLLATE NOCASE');
        $voucher = $this->db->prepare(
            'INSERT INTO vouchers (type, number, date, narration, reference, party_ledger_id, total_paise, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $line = $this->db->prepare(
            'INSERT INTO voucher_lines (voucher_id, ledger_id, amount_paise, bill_ref, position) VALUES (?, ?, ?, ?, ?)'
        );
        $inventory = $this->db->prepare(
            'INSERT INTO voucher_inventory (voucher_id, stock_item_id, qty_milli, rate_paise, amount_paise) VALUES (?, ?, ?, ?, ?)'
        );
        $direction = static fn (string $type): int => match ($type) {
            'PURCHASE', 'CREDIT_NOTE' => 1,
            'SALES', 'DEBIT_NOTE' => -1,
            default => 0,
        };

        foreach ($vouchers as $entry) {
            $partyId = null;
            if (!empty($entry['party'])) {
                $ledger->execute([$entry['party']]);
                $partyId = $ledger->fetchColumn();
                $partyId = $partyId === false ? null : (int) $partyId;
            }
            $voucher->execute([
                $entry['type'],
                $entry['number'],
                $entry['date'],
                $entry['narration'] ?? null,
                $entry['reference'] ?? null,
                $partyId,
                Money::toPaise($entry['total'] ?? 0),
                gmdate('Y-m-d\TH:i:s\Z'),
                gmdate('Y-m-d\TH:i:s\Z'),
            ]);
            $voucherId = (int) $this->db->lastInsertId();
            foreach ($entry['lines'] as $position => $row) {
                $ledger->execute([$row['ledger']]);
                $ledgerId = $ledger->fetchColumn();
                if ($ledgerId === false) {
                    throw new TallyCraftError('UNKNOWN_LEDGER', sprintf('Seed voucher uses unknown ledger "%s"', $row['ledger']));
                }
                $line->execute([
                    $voucherId,
                    (int) $ledgerId,
                    Money::toPaise($row['amount']),
                    $row['billRef'] ?? null,
                    $position,
                ]);
            }
            foreach ($entry['inventory'] ?? [] as $row) {
                $item->execute([$row['item']]);
                $itemId = $item->fetchColumn();
                if ($itemId === false) {
                    throw new TallyCraftError('UNKNOWN_STOCK_ITEM', sprintf('Seed voucher uses unknown item "%s"', $row['item']));
                }
                $sign = $direction((string) $entry['type']);
                $inventory->execute([
                    $voucherId,
                    (int) $itemId,
                    $sign * (int) round(((float) $row['quantity']) * 1000),
                    Money::toPaise($row['rate'] ?? 0),
                    Money::toPaise($row['amount'] ?? 0),
                ]);
            }
        }
    }
}
