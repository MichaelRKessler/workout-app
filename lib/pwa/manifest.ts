import type { MetadataRoute } from "next";

export const pwaName = "Workout";
export const pwaShortName = "Workout";
export const pwaDescription =
  "Log sets, reps, and weight, then come back to the history.";
export const pwaThemeColor = "#f7f7f5";
export const pwaBackgroundColor = "#f7f7f5";

/**
 * Install criteria for current Chrome: name, short_name, start_url, standalone
 * display, and PNG icons at 192 and 512. Maskable icons sit beside purpose
 * "any" so Android can crop the launcher icon. No service worker is registered.
 * Chrome promotes installation from this manifest alone, and a fetch handler
 * could cache a signed-in page, a Convex response, or /api/voice.
 */
export const webAppManifest: MetadataRoute.Manifest = {
  id: "/",
  name: pwaName,
  short_name: pwaShortName,
  description: pwaDescription,
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: pwaBackgroundColor,
  theme_color: pwaThemeColor,
  lang: "en",
  categories: ["health", "fitness"],
  prefer_related_applications: false,
  launch_handler: {
    client_mode: "navigate-existing",
  },
  icons: [
    {
      src: "/icons/icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icons/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icons/icon-maskable-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "maskable",
    },
    {
      src: "/icons/icon-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
};
