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
      <head>
        {/* Chrome reads this from the first HTML chunk. Metadata streamed after
            Convex Auth makes the layout dynamic arrives too late. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <link
          rel="apple-touch-icon"
          href="/icons/apple-touch-icon.png"
          sizes="180x180"
        />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content={pwaName} />
        <meta name="apple-mobile-web-app-status-bar-style" content="black" />
      </head>
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
