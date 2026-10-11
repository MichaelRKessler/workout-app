/** Maps the Convex access query onto the voice route's allow decision. */
export function readVoiceAccess(input: {
  token: string | null | undefined;
  status: { allowed: boolean } | null;
}): { signedIn: boolean; allowed: boolean } {
  if (!input.token || input.status === null) {
    return { signedIn: false, allowed: false };
  }
  return { signedIn: true, allowed: input.status.allowed };
}
