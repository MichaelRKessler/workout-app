const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

/** Ids generated on the phone. They are not secrets, just stable keys. */
export function isClientId(value: string): boolean {
  return CLIENT_ID_PATTERN.test(value);
}
