/**
 * A "4 exercises · 9 sets · 7,710 lb" line that only wraps between parts, so a
 * number never ends up on one line and its unit on the next. The dot stays at
 * the end of a line, never at the start of the next one.
 */
export function MetaLine({ text, className }: { text: string; className?: string }) {
  const parts = text.split(" · ");
  return (
    <span className={className}>
      {parts.map((part, index) => (
        <span key={index}>
          <span className="whitespace-nowrap">
            {part}
            {index < parts.length - 1 ? " ·" : ""}
          </span>
          {index < parts.length - 1 ? " " : ""}
        </span>
      ))}
    </span>
  );
}
