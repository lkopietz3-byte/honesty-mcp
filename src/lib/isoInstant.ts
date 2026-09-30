// Strict ISO 8601 parsing for tool inputs such as check_claims_registry's
// `now`. A copy of claims-registry-kit's internal `parseIsoInstant`
// (src/dates.ts, not exported by the kit), so `now` follows the same rules as
// the kit's own `verifiedAt`:
//
// Accepted:  YYYY-MM-DD                          (UTC midnight)
//            YYYY-MM-DD[T or space]HH:mm[:ss[.f{1,9}]][Z | +HH[[:]mm] | -HH[[:]mm]]
//
// A timestamp WITH a time-of-day but no zone is rejected rather than read as
// local time, and impossible moments (Feb 30, hour 24, minute 60) are
// rejected rather than rolled forward, which is what `new Date(string)` does.

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:([Zz])|([+-])(\d{2})(?::?(\d{2}))?)?)?$/;

const MS_PER_MINUTE = 60_000;

/** Result of a successful parse: the instant, and whether the input had no time component. */
export interface ParsedIsoInstant {
  /** Epoch milliseconds. */
  instant: number;
  /** True for a bare `YYYY-MM-DD` value; false for any timestamp, offset or not. */
  dateOnly: boolean;
}

/**
 * Parse an ISO 8601 date or timestamp, or `null` when the value is not a
 * string, not one of the accepted forms, or names a moment that does not
 * exist (Feb 30, hour 24, minute 60, ...).
 *
 * `dateOnly` distinguishes a bare calendar date from an explicit timestamp:
 * a bare date carries no time zone, so a caller may reasonably get a
 * future-date grace period a timestamp (an exact, zoned instant) should not
 * — see `checks.ts`'s future-tolerance handling.
 *
 * A timestamp (has a time-of-day) with no `Z`/offset is unparseable, not
 * silently read as UTC: "2026-01-01T12:00:00" names a ~14-hour-wide band of
 * real instants depending on the caller's local time zone, and guessing UTC
 * would give the same string a different, silently-wrong age depending on
 * where it was evaluated. A bare `YYYY-MM-DD` date has no time-of-day to be
 * ambiguous about, so it is still read as UTC midnight.
 */
export function parseIsoInstant(value: unknown): ParsedIsoInstant | null {
  if (typeof value !== 'string') return null;
  const match = ISO.exec(value);
  if (match === null) return null;

  const dateOnly = match[4] === undefined;
  const hasZone = match[8] !== undefined || match[9] !== undefined;
  if (!dateOnly && !hasZone) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] === undefined ? 0 : Number(match[4]);
  const minute = match[5] === undefined ? 0 : Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  // Keep milliseconds; extra fractional digits are truncated, not rounded.
  const millis = match[7] === undefined ? 0 : Number(match[7].padEnd(3, '0').slice(0, 3));

  if (hour > 23 || minute > 59 || second > 59) return null;

  // Date.UTC would map years 0-99 onto 1900-1999, so build the date with
  // setUTCFullYear, then confirm the calendar day survived (no roll-over).
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  date.setUTCHours(hour, minute, second, millis);

  let offsetMinutes = 0;
  if (match[9] !== undefined) {
    const offsetHours = Number(match[10]);
    const offsetMins = match[11] === undefined ? 0 : Number(match[11]);
    if (offsetHours > 23 || offsetMins > 59) return null;
    const sign = match[9] === '-' ? -1 : 1;
    offsetMinutes = sign * (offsetHours * 60 + offsetMins);
  }

  return { instant: date.getTime() - offsetMinutes * MS_PER_MINUTE, dateOnly };
}
