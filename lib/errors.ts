export function readableError(error: unknown): string {
  if (!(error instanceof Error) || error.message.trim().length === 0) {
    return "Something went wrong. Try again.";
  }

  const lines = error.message.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    const prefix = "Uncaught Error: ";
    if (trimmed.startsWith(prefix)) {
      const message = trimmed.slice(prefix.length).trim();
      return message.length > 0 ? message : "Something went wrong. Try again.";
    }
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
    readable === "Something went wrong. Try again." ||
    looksLikeConvexWrapper(readable)
  ) {
    return "Something went wrong";
  }
  return readable;
}

function looksLikeConvexWrapper(message: string): boolean {
  return (
    message.includes("[Request ID:") ||
    message.includes("[CONVEX ") ||
    message.includes("Uncaught Error:") ||
    message.includes("Uncaught ConvexError:")
  );
}
