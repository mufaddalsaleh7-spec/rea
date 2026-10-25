<?php

declare(strict_types=1);

namespace TallyCraft;

/**
 * A report name that does not exist is a 404, not a 400.
 *
 * The Node router answers `404 {code:"UNKNOWN_REPORT"}` from its report switch;
 * this subclass keeps that distinction instead of letting every refusal share
 * one status.
 */
final class UnknownReport extends \RuntimeException
{
}
