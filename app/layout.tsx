import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import Script from "next/script";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { SetupRequired } from "@/components/SetupRequired";
import { pwaDescription, pwaName } from "@/lib/pwa/manifest";
import {
  appleStatusBarStyle,
  parseTheme,
  THEME_COLORS,
  THEME_COOKIE,
} from "@/lib/theme";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: {
    default: pwaName,
    template: `%s · ${pwaName}`,
  },
  description: pwaDescription,
  applicationName: pwaName,
};

// theme-color is written in <head> below so it can follow the saved theme.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const configured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html lang="en" data-theme={theme} suppressHydrationWarning>
      <head>
        {/* Chrome reads this from the first HTML chunk. Metadata streamed after
            Convex Auth makes the layout dynamic arrives too late. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <link
          rel="apple-touch-icon"
          href="/icons/apple-touch-icon.png"
          sizes="180x180"
        />
        <meta name="theme-color" content={THEME_COLORS[theme]} />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content={pwaName} />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content={appleStatusBarStyle(theme)}
        />
      </head>
      <body className={`${geist.variable} ${geistMono.variable} antialiased`}>
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
