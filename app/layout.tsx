import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { SetupRequired } from "@/components/SetupRequired";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

export const metadata: Metadata = {
  title: {
    default: "Workout",
    template: "%s · Workout",
  },
  description: "Log sets, reps, and weight, then come back to the history.",
  applicationName: "Workout",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#12110e",
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
