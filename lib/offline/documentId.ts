/**
 * Ids this phone generates. `crypto.randomUUID` without dashes is 32 hex
 * characters. The fallback starts with "c".
 *
 * Convex document ids use a wider base32 alphabet, so a 32-character hex
 * string is one of ours and must not be sent as a set id. Sending one fails
 * argument validation for the whole batch.
 */
/** Convex document ids are 32-character Crockford base32. */
const CROCKFORD_ID = /^[0-9a-hjkmnp-tv-z]{32}$/;

export function isPhoneClientId(value: string): boolean {
  if (/^[0-9a-f]{32}$/i.test(value)) {
    return true;
  }
  if (!/^c[0-9a-z]{10,48}$/.test(value)) {
    return false;
  }
  // A fallback id is base36 and not 32 Crockford characters. A real set id
  // can start with "c", and must still be sent.
  return !CROCKFORD_ID.test(value);
}

/**
 * Maps a queued id to a server document id.
 * A phone client id is only sent when this outbox has already learned the
 * server id it belongs to.
 */
export function resolveDocumentId(
  value: string,
  knownServerIds: ReadonlyMap<string, string>,
): string | null {
  const mapped = knownServerIds.get(value);
  if (mapped && !isPhoneClientId(mapped)) {
    return mapped;
  }
  if (isPhoneClientId(value)) {
    return null;
  }
  if (value.length < 8 || value.length > 80 || value.startsWith("pending:")) {
    return null;
  }
  return value;
}
