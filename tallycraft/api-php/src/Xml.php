<?php

declare(strict_types=1);

namespace TallyCraft;

/**
 * A small XML reader for Tally envelopes.
 *
 * Same reader contract as `src/xml.js`: child order preserved, attributes kept,
 * mismatched tags rejected, external entities never expanded. Nodes are plain
 * arrays — `['name' => ..., 'attributes' => [...], 'children' => [...], 'text' => ...]`
 * — because that is what the rest of this backend already speaks.
 */
final class Xml
{
    private const ENTITIES = [
        'amp' => '&',
        'lt' => '<',
        'gt' => '>',
        'quot' => '"',
        'apos' => "'",
    ];

    /**
     * Parse a document into a `#document` node.
     *
     * Recursive descent, not a tag stack: a stack of PHP arrays needs
     * references, references inside arrays are a trap, and the nesting depth
     * of a Tally envelope is a handful of levels.
     *
     * @return array{name: string, attributes: array<string, string>, children: array<int, array>, text: string}
     */
    public static function parse(string $source): array
    {
        $root = self::node('#document');
        $position = 0;
        self::parseChildren($source, $position, $root);

        return $root;
    }

    /**
     * @param array{name: string, attributes: array<string, string>, children: array<int, array>, text: string} $parent
     */
    private static function parseChildren(string $source, int &$position, array &$parent): void
    {
        $length = strlen($source);
        while ($position < $length) {
            $open = strpos($source, '<', $position);
            if ($open === false) {
                $tail = trim(substr($source, $position));
                if ($tail !== '') {
                    $parent['text'] .= self::decode($tail);
                }
                $position = $length;
                return;
            }
            if ($open > $position) {
                $chunk = substr($source, $position, $open - $position);
                if (trim($chunk) !== '') {
                    $parent['text'] .= self::decode($chunk);
                }
            }

            if (substr($source, $open, 4) === '<!--') {
                $close = strpos($source, '-->', $open + 4);
                if ($close === false) {
                    throw new \RuntimeException('Unterminated XML comment');
                }
                $position = $close + 3;
                continue;
            }
            if (substr($source, $open, 9) === '<![CDATA[') {
                $close = strpos($source, ']]>', $open + 9);
                if ($close === false) {
                    throw new \RuntimeException('Unterminated CDATA section');
                }
                $parent['text'] .= substr($source, $open + 9, $close - $open - 9);
                $position = $close + 3;
                continue;
            }
            if (substr($source, $open, 2) === '<?') {
                $close = strpos($source, '?>', $open + 2);
                if ($close === false) {
                    throw new \RuntimeException('Unterminated processing instruction');
                }
                $position = $close + 2;
                continue;
            }
            if (substr($source, $open, 2) === '<!') {
                $close = strpos($source, '>', $open + 2);
                if ($close === false) {
                    throw new \RuntimeException('Unterminated declaration');
                }
                $position = $close + 1;
                continue;
            }

            $close = strpos($source, '>', $open);
            if ($close === false) {
                throw new \RuntimeException('Unterminated XML tag');
            }

            if (substr($source, $open, 2) === '</') {
                $name = trim(substr($source, $open + 2, $close - $open - 2));
                if ($name !== $parent['name']) {
                    throw new \RuntimeException(sprintf(
                        'Mismatched closing tag </%s> inside <%s>',
                        $name,
                        $parent['name']
                    ));
                }
                $position = $close + 1;

                return;
            }

            $raw = substr($source, $open + 1, $close - $open - 1);
            $selfClosing = str_ends_with($raw, '/');
            $body = ltrim($selfClosing ? substr($raw, 0, -1) : $raw);
            if (preg_match('/^([\w.:-]+)/', $body, $match) !== 1) {
                throw new \RuntimeException(sprintf('Invalid XML tag <%s>', $raw));
            }
            $node = self::node($match[1]);
            $node['attributes'] = self::attributes(substr($body, strlen($match[1])));
            $position = $close + 1;
            if (!$selfClosing) {
                self::parseChildren($source, $position, $node);
            }
            $parent['children'][] = $node;
        }

        if ($parent['name'] !== '#document') {
            throw new \RuntimeException(sprintf('Unclosed XML tag <%s>', $parent['name']));
        }
    }

    /**
     * Depth-first search for every node with one of the given tag names.
     *
     * @param array<int, string> $names
     * @param array<int, array> $found
     * @return array<int, array>
     */
    public static function findAll(array $node, array $names, array &$found = []): array
    {
        $wanted = array_map('strtoupper', $names);
        if (in_array(strtoupper((string) $node['name']), $wanted, true)) {
            $found[] = $node;
        }
        foreach ($node['children'] as $child) {
            self::findAll($child, $names, $found);
        }

        return $found;
    }

    /** Text of the first direct child with this tag, trimmed, or null. */
    public static function childText(array $node, string $name): ?string
    {
        $wanted = strtoupper($name);
        foreach ($node['children'] as $child) {
            if (strtoupper((string) $child['name']) === $wanted) {
                return trim((string) $child['text']);
            }
        }

        return null;
    }

    /**
     * Every direct child with this tag.
     *
     * @return array<int, array>
     */
    public static function childrenNamed(array $node, string $name): array
    {
        $wanted = strtoupper($name);

        return array_values(array_filter(
            $node['children'],
            static fn (array $child): bool => strtoupper((string) $child['name']) === $wanted
        ));
    }

    public static function escape(string $value): string
    {
        return str_replace(
            ['&', '<', '>', '"', "'"],
            ['&amp;', '&lt;', '&gt;', '&quot;', '&apos;'],
            $value
        );
    }

    /** Paise rendered the way Tally writes amounts: "-1234.50". */
    public static function amount(int $paise): string
    {
        $absolute = abs($paise);
        $whole = intdiv($absolute, 100);
        $fraction = str_pad((string) ($absolute % 100), 2, '0', STR_PAD_LEFT);

        return ($paise < 0 ? '-' : '') . $whole . '.' . $fraction;
    }

    /** @return array{name: string, attributes: array<string, string>, children: array<int, array>, text: string} */
    private static function node(string $name): array
    {
        return ['name' => $name, 'attributes' => [], 'children' => [], 'text' => ''];
    }

    /** @return array<string, string> */
    private static function attributes(string $source): array
    {
        $attributes = [];
        if (preg_match_all('/([\w.:-]+)\s*=\s*("([^"]*)"|\'([^\']*)\')/', $source, $matches, PREG_SET_ORDER) === false) {
            return $attributes;
        }
        foreach ($matches as $match) {
            $attributes[$match[1]] = self::decode($match[3] !== '' ? $match[3] : ($match[4] ?? ''));
        }

        return $attributes;
    }

    private static function decode(string $text): string
    {
        return preg_replace_callback(
            '/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/',
            static function (array $match): string {
                $body = $match[1];
                if (str_starts_with($body, '#x') || str_starts_with($body, '#X')) {
                    $code = (int) hexdec(substr($body, 2));

                    return $code > 0 ? self::chr($code) : $match[0];
                }
                if (str_starts_with($body, '#')) {
                    $code = (int) substr($body, 1);

                    return $code > 0 ? self::chr($code) : $match[0];
                }

                return self::ENTITIES[$body] ?? $match[0];
            },
            $text
        ) ?? $text;
    }

    private static function chr(int $code): string
    {
        if (function_exists('mb_chr')) {
            $character = mb_chr($code, 'UTF-8');

            return $character === false ? '' : $character;
        }

        // Hand-rolled UTF-8: mbstring is not guaranteed on every PHP host.
        if ($code < 0x80) {
            return chr($code);
        }
        if ($code < 0x800) {
            return chr(0xC0 | ($code >> 6)) . chr(0x80 | ($code & 0x3F));
        }
        if ($code < 0x10000) {
            return chr(0xE0 | ($code >> 12)) . chr(0x80 | (($code >> 6) & 0x3F)) . chr(0x80 | ($code & 0x3F));
        }

        return chr(0xF0 | ($code >> 18))
            . chr(0x80 | (($code >> 12) & 0x3F))
            . chr(0x80 | (($code >> 6) & 0x3F))
            . chr(0x80 | ($code & 0x3F));
    }
}
