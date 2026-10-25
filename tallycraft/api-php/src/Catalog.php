<?php

declare(strict_types=1);

namespace TallyCraft;

/**
 * Chart of accounts and voucher types, loaded from the generated catalogue.
 *
 * `data/catalog.json` is produced by `scripts/export-php-data.mjs` out of
 * `src/catalog.js`, so the PHP backend cannot invent a group or a voucher type
 * the Node backend does not know. Everything here is lookup, no policy.
 */
final class Catalog
{
    /** @var array<int, array<string, mixed>> */
    public array $groups = [];

    /** @var array<int, string> */
    public array $primaryGroups = [];

    /** @var array<int, array<string, mixed>> */
    public array $voucherTypes = [];

    /** @var array<int, string> */
    public array $units = [];

    /** @var array<int, float|int> */
    public array $gstRates = [];

    /** @var array<string, array<string, mixed>> */
    private array $groupsByName = [];

    /** @var array<string, array<string, mixed>> */
    private array $typesByCode = [];

    /** @var array<string, array<string, mixed>> */
    private array $typesByName = [];

    /** @var array<string, array<string, mixed>> */
    private array $typesByShortcut = [];

    public static function load(string $path): self
    {
        $raw = @file_get_contents($path);
        if ($raw === false) {
            throw new \RuntimeException("Catalogue missing at {$path}. Run `npm run export:php`.");
        }
        $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);

        $catalog = new self();
        $catalog->groups = $data['groups'] ?? [];
        $catalog->primaryGroups = $data['primaryGroups'] ?? [];
        $catalog->voucherTypes = $data['voucherTypes'] ?? [];
        $catalog->units = $data['units'] ?? [];
        $catalog->gstRates = $data['gstRates'] ?? [];

        foreach ($catalog->groups as $group) {
            $catalog->groupsByName[(string) $group['name']] = $group;
        }
        foreach ($catalog->voucherTypes as $type) {
            $catalog->typesByCode[(string) $type['code']] = $type;
            $catalog->typesByName[(string) $type['name']] = $type;
            $catalog->typesByShortcut[(string) $type['shortcut']] = $type;
        }

        return $catalog;
    }

    /** @return array<string, mixed>|null */
    public function group(string $name): ?array
    {
        return $this->groupsByName[$name] ?? null;
    }

    /** @return array<string, mixed>|null */
    public function voucherType(string $code): ?array
    {
        return $this->typesByCode[$code] ?? null;
    }

    /** @return array<string, mixed>|null */
    public function voucherTypeByName(string $name): ?array
    {
        return $this->typesByName[$name] ?? null;
    }

    /** @return array<string, mixed>|null */
    public function voucherTypeByShortcut(string $shortcut): ?array
    {
        return $this->typesByShortcut[$shortcut] ?? null;
    }

    /** Display name for a stored voucher type code. */
    public function voucherTypeName(string $code): string
    {
        return $this->typesByCode[$code]['name'] ?? $code;
    }

    /**
     * Resolve a type given as code, name or shortcut — the same three
     * spellings the Node API accepts, in the same order.
     */
    public function resolveVoucherType(string $value): string
    {
        $key = trim($value);
        $upper = strtoupper($key);
        $match = $this->typesByCode[$upper]
            ?? $this->typesByName[$key]
            ?? $this->typesByShortcut[$key]
            ?? null;
        if ($match === null) {
            throw new TallyCraftError(
                'UNKNOWN_VOUCHER_TYPE',
                sprintf('Unknown voucher type "%s"', $value),
                ['types' => array_map(static fn (array $type): string => (string) $type['name'], $this->voucherTypes)]
            );
        }

        return (string) $match['code'];
    }

    /** Groups in the order Tally Prime presents them. */
    public function primaryGroupNames(): array
    {
        return $this->primaryGroups;
    }
}
