/**
 * Shown the moment a link is tapped while the next page is on its way, so the
 * old screen never sits frozen. Kept blank to avoid a flash when it is quick.
 */
export default function Loading() {
  return (
    <div aria-busy="true" className="min-h-dvh">
      <span className="sr-only">Loading…</span>
    </div>
  );
}
