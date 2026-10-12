import { ConvexError } from "convex/values";

/**
 * A message the person should see. Convex shows `ConvexError` data in
 * production and hides a plain `Error`, so validation and permission failures
 * go through here. Unexpected bugs stay `throw new Error` and remain hidden.
 */
export function userError(message: string): ConvexError<string> {
  return new ConvexError(message);
}
