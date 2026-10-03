import { formatSessionWhen } from "@/lib/format";

export function LocalTime({ timestamp }: { timestamp: number }) {
  return (
    <time
      dateTime={new Date(timestamp).toISOString()}
      suppressHydrationWarning
    >
      {formatSessionWhen(timestamp)}
    </time>
  );
}
