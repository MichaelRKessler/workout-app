export function readableError(error: unknown): string {
  if (!(error instanceof Error) || error.message.trim().length === 0) {
    return "Something went wrong. Try again.";
  }

  const lines = error.message.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    const prefix = "Uncaught Error: ";
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length);
    }
  }

  return error.message;
}
