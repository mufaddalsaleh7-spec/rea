<?php

declare(strict_types=1);

namespace TallyCraft;

/**
 * Money helpers: integer paise in, JSON-ready rupee numbers out.
 *
 * PHP and JavaScript must serialise the same figure for the same paise value,
 * or the parity test fails and, worse, two backends disagree about a balance.
 * `json_encode()` with `serialize_precision = -1` prints the shortest
 * round-tripping decimal, which is what `JSON.stringify()` does, so dividing by
 * 100 is the whole conversion.
 */
final class Money
{
    public const PAISE_PER_RUPEE = 100;

    /** Signed paise to a rupee number, exactly as the Node API reports it. */
    public static function toRupees(int $paise): float|int
    {
        $rupees = $paise / self::PAISE_PER_RUPEE;
        // Keep integers integral so `21040.0` does not become a different JSON
        // token than JavaScript's `21040`.
        return floor($rupees) === $rupees ? (int) $rupees : $rupees;
    }

    /** Convert a rupee amount (float or numeric string) to integer paise. */
    public static function toPaise(float|int|string $rupees): int
    {
        return (int) round(((float) $rupees) * self::PAISE_PER_RUPEE);
    }

    /** Rupee number back to paise when a report has already rounded. */
    public static function fromRupees(float|int|string $rupees): int
    {
        return self::toPaise($rupees);
    }

    /** Human text used in error details: "12,34,567.89". */
    public static function formatPaise(int $paise): string
    {
        $negative = $paise < 0;
        $absolute = abs($paise);
        $whole = intdiv($absolute, self::PAISE_PER_RUPEE);
        $fraction = $absolute % self::PAISE_PER_RUPEE;
        $text = self::groupIndian((string) $whole) . '.' . str_pad((string) $fraction, 2, '0', STR_PAD_LEFT);

        return ($negative ? '-' : '') . $text;
    }

    /** Indian digit grouping: 12,34,56,789. */
    private static function groupIndian(string $digits): string
    {
        $length = strlen($digits);
        if ($length <= 3) {
            return $digits;
        }
        $last3 = substr($digits, -3);
        $rest = substr($digits, 0, -3);
        $chunks = [];
        while (strlen($rest) > 2) {
            array_unshift($chunks, substr($rest, -2));
            $rest = substr($rest, 0, -2);
        }
        if ($rest !== '') {
            array_unshift($chunks, $rest);
        }

        return implode(',', $chunks) . ',' . $last3;
    }
}
