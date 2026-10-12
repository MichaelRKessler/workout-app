const GENERIC = "Something went wrong. Try again.";

/**
 * Text for a toast or an inline error.
 * A ConvexError carries the sentence the server meant to show. Production
 * otherwise replaces that sentence with "Server Error" and a request id.
 */
export function readableError(error: unknown): string {
  const fromData = convexErrorMessage(error);
  if (fromData) {
    return fromData;
  }

  if (!(error instanceof Error) || error.message.trim().length === 0) {
    return GENERIC;
  }

  const lines = error.message.split("\n");
  for (const line of lines) {
    const extracted = uncaughtMessage(line.trim());
    if (extracted !== null) {
      return extracted.length > 0 ? extracted : GENERIC;
    }
  }

  if (looksLikeConvexWrapper(error.message)) {
    return GENERIC;
  }
  return error.message;
}

/**
 * Error-page copy. Convex wraps the thrown message with the function name,
 * a request id, and an Uncaught Error prefix. Show the thrown message, or a
 * plain sentence when the wrapper is all there is.
 */
export function errorPageMessage(error: unknown): string {
  const readable = readableError(error);
  if (
    readable.trim().length === 0 ||
    readable === GENERIC ||
    looksLikeConvexWrapper(readable)
  ) {
    return "Something went wrong";
  }
  return readable;
}

/**
 * A rejected argument, as opposed to a rule the person broke.
 * The offline queue splits a batch on this and retries the rest. A ConvexError
 * such as "Workout not found" is not one of these.
 */
export function isArgumentValidationError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  if ("name" in error && error.name === "ArgumentValidationError") {
    return true;
  }
  return error instanceof Error && error.message.includes("ArgumentValidationError");
}

function convexErrorMessage(error: unknown): string | null {
  if (!isConvexError(error)) {
    return null;
  }
  const data: unknown = error.data;
  if (typeof data === "string") {
    const message = data.trim();
    return message.length > 0 ? message : null;
  }
  if (data && typeof data === "object" && "message" in data && typeof data.message === "string") {
    const message = data.message.trim();
    return message.length > 0 ? message : null;
  }
  return null;
}

function isConvexError(error: unknown): error is { data: unknown; name?: string } {
  if (!error || typeof error !== "object") {
    return false;
  }
  if ("name" in error && error.name === "ConvexError") {
    return "data" in error;
  }
  const brand = Symbol.for("ConvexError");
  return brand in error && "data" in error;
}

function uncaughtMessage(trimmed: string): string | null {
  const prefix = trimmed.startsWith("Uncaught ConvexError: ")
    ? "Uncaught ConvexError: "
    : trimmed.startsWith("Uncaught Error: ")
      ? "Uncaught Error: "
      : null;
  if (!prefix) {
    return null;
  }
  const rest = trimmed.slice(prefix.length).trim();
  if (rest.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(rest);
      if (
        parsed &&
        typeof parsed === "object" &&
        "message" in parsed &&
        typeof parsed.message === "string"
      ) {
        return parsed.message.trim();
      }
    } catch {
      return rest;
    }
  }
  return rest;
}

function looksLikeConvexWrapper(message: string): boolean {
  return (
    message.includes("[Request ID:") ||
    message.includes("[CONVEX ") ||
    message.includes("Uncaught Error:") ||
    message.includes("Uncaught ConvexError:")
  );
}
