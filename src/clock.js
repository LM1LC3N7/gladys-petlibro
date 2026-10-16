// -----------------------------------------------------------------------------
// Time (pure): PETLIBRO counts "today" in the time zone sent with every
// request, and dates its records in epoch milliseconds.
// -----------------------------------------------------------------------------

/** The zone of the process: Gladys gives its own to the container (TZ). */
export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** An IANA zone name Node knows ("Europe/Paris"). */
export function validZone(zone) {
  if (typeof zone !== 'string' || zone === '' || /['"\\\r\n]/.test(zone)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * An instant written by PETLIBRO -> ms since the epoch, undefined when absent
 * or unreadable: epoch milliseconds (or seconds) as a number or digits, or an
 * ISO date.
 */
export function parseInstant(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
      return undefined;
    }
    return number < 1e12 ? number * 1000 : number;
  }
  const at = Date.parse(String(value));
  return Number.isNaN(at) ? undefined : at;
}
