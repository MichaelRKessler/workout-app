import { isShellCacheName } from "./cachePolicy.ts";

/** Drop every shell cache, including pages cached before the token fix. */
export async function clearShellCache(): Promise<void> {
  if (typeof caches === "undefined") {
    return;
  }
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((key) => isShellCacheName(key)).map((key) => caches.delete(key)),
  );
}
