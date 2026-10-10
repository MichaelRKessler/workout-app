import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import Script from "next/script";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { SetupRequired } from "@/components/SetupRequired";
import {
  pwaDescription,
  pwaName,
  pwaThemeColor,
} from "@/lib/pwa/manifest";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

export const metadata: Metadata = {
  title: {
    default: pwaName,
    template: `%s · ${pwaName}`,
  },
  description: pwaDescription,
  applicationName: pwaName,
  appleWebApp: {
    capable: true,
    title: pwaName,
    statusBarStyle: "black",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: pwaThemeColor,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const configured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

  return (
    <html lang="en">
      <body className={`${outfit.variable} antialiased`}>
        <Script id="pwa-install-prompt" strategy="beforeInteractive">
          {`window.__deferredInstallPrompt=null;window.addEventListener("beforeinstallprompt",function(event){event.preventDefault();window.__deferredInstallPrompt=event;window.dispatchEvent(new Event("pwa-installable"));});window.addEventListener("appinstalled",function(){window.__deferredInstallPrompt=null;window.dispatchEvent(new Event("pwa-installed"));});`}
        </Script>
        {configured ? (
          <ConvexAuthNextjsServerProvider>
            <ConvexClientProvider>{children}</ConvexClientProvider>
          </ConvexAuthNextjsServerProvider>
        ) : (
          <SetupRequired />
        )}
      </body>
    </html>
  );
}
