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
 * "any" so Android can crop the launcher icon. Production registers a
 * network-first service worker so the installed app can open offline. It does
 * not cache /api, Convex, Google, or the OAuth return. Signed-in HTML is
 * stored only after the login token is removed, and a live network response
 * always replaces that shell.
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
  shortcuts: [
    {
      name: "New workout",
      short_name: "New",
      description: "Start a workout, or continue the one already open",
      url: "/start?action=new&source=shortcut",
      icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    },
    {
      name: "Repeat last workout",
      short_name: "Repeat",
      description: "Start from the exercises in your latest finished workout",
      url: "/start?action=repeat&source=shortcut",
      icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    },
    {
      name: "Routines",
      short_name: "Routines",
      description: "Open your saved routines",
      url: "/routines",
      icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    },
    {
      name: "Log body weight",
      short_name: "Body",
      description: "Log body weight and measurements",
      url: "/body",
      icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    },
  ],
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
