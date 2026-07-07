/**
 * Normalize a phone number to E.164 format.
 * Defaults to Iraqi format (+964...) if no country code is present (e.g. starts with 07... or 7...).
 * If it starts with + or 00, it is treated as an international number.
 *
 * Returns null when there are no real digits left to normalize (empty input,
 * whitespace, or junk with no digits at all) — callers must treat null as
 * "no usable phone number" and skip whatever they were about to do with it.
 */
export function normalizePhone(raw: string): string | null {
  const cleaned = raw.trim().replace(/[\s\-\(\)]/g, "");

  // Already international: leading + or 00 — trust the caller's country code.
  if (cleaned.startsWith("+")) {
    const digits = cleaned.slice(1).replace(/\D/g, "");
    return digits ? "+" + digits : null;
  }
  if (cleaned.startsWith("00")) {
    const digits = cleaned.slice(2).replace(/\D/g, "");
    return digits ? "+" + digits : null;
  }

  // Local/national format — strip everything but digits.
  let digits = cleaned.replace(/\D/g, "");

  // Drop a single leading trunk "0" (Iraqi local dialing convention: 07xx...).
  if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if (!digits) return null; // nothing left after stripping — no real number

  // Already has an explicit country code.
  if (digits.startsWith("964")) {
    return "+" + digits;
  }

  // Bare national number — assume Iraqi.
  return "+964" + digits;
}

/**
 * Derive a suffix to match phone numbers stored in E.164 format, tolerant of
 * how the searcher typed the query: full international ("+9647701234567"),
 * local with trunk zero ("07701234567"), bare national ("7701234567"), or
 * just the trailing digits someone remembers ("34567", min 4 digits).
 *
 * Unlike normalizePhone, a leading "0"/"964"/"00" here is treated as a prefix
 * to strip (not a value to keep) since callers only ever want to compare
 * against the tail of the stored number via `endsWith`.
 *
 * Returns null when there are fewer than 4 usable digits — too short to
 * search on without matching almost everything.
 */
export function phoneSearchSuffix(raw: string): string | null {
  const cleaned = raw.trim().replace(/[\s\-\(\)]/g, "");
  let digits = cleaned.replace(/^\+/, "").replace(/\D/g, "");

  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("964")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);

  if (digits.length < 4) return null;

  return digits.slice(-10);
}
