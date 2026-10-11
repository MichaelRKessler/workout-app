"use client";

import { Button } from "@/components/Button";
import { SectionLabel } from "@/components/PageHeader";
import {
  installOffer,
  isIosSafari,
  isRunningInstalled,
  type InstallOfferKind,
} from "@/lib/pwa/installOffer";
import { useEffect, useState } from "react";

function readKind(): InstallOfferKind {
  const nav = navigator as Navigator & { standalone?: boolean };
  const prompt = window.__deferredInstallPrompt;
  return installOffer({
    installed: isRunningInstalled({
      standalone: window.matchMedia("(display-mode: standalone)").matches,
      navigatorStandalone: nav.standalone === true,
    }),
    promptAvailable: prompt != null,
    iosSafari: isIosSafari({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
    }),
  });
}

/**
 * "inline" sits under the sign-in button. "settings" is a whole Settings
 * section and renders nothing when the app is installed or cannot be.
 */
export function InstallOffer({
  className = "",
  variant = "inline",
}: {
  className?: string;
  variant?: "inline" | "settings";
}) {
  const [kind, setKind] = useState<InstallOfferKind>("hidden");

  useEffect(() => {
    const sync = () => {
      setKind(readKind());
    };
    sync();
    window.addEventListener("pwa-installable", sync);
    window.addEventListener("pwa-installed", sync);
    const standalone = window.matchMedia("(display-mode: standalone)");
    standalone.addEventListener("change", sync);
    return () => {
      window.removeEventListener("pwa-installable", sync);
      window.removeEventListener("pwa-installed", sync);
      standalone.removeEventListener("change", sync);
    };
  }, []);

  async function onInstall() {
    const deferred = window.__deferredInstallPrompt;
    if (!deferred) {
      return;
    }
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (window.__deferredInstallPrompt === deferred) {
        window.__deferredInstallPrompt = null;
      }
      if (choice.outcome === "accepted") {
        setKind("hidden");
        return;
      }
    } catch {
      return;
    }
    setKind(readKind());
  }

  if (kind === "hidden") {
    return null;
  }

  if (variant === "settings") {
    return (
      <section aria-labelledby="settings-install" className={`mt-7 ${className}`}>
        <SectionLabel id="settings-install">App</SectionLabel>
        <div className="overflow-hidden rounded-[1.25rem] border border-line bg-surface">
          {kind === "ios-hint" ? (
            <p className="px-4 py-4 text-base leading-normal text-muted">
              Install it from Safari: Share, then Add to Home Screen.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void onInstall()}
              className="flex min-h-14 w-full items-center px-4 text-left text-base font-medium hover:bg-fill-2"
            >
              Install app
            </button>
          )}
        </div>
      </section>
    );
  }

  if (kind === "ios-hint") {
    return (
      <p className={`text-sm text-muted ${className}`}>
        Add to Home Screen from the Share menu.
      </p>
    );
  }

  return (
    <div className={className}>
      <Button variant="secondary" onClick={() => void onInstall()}>
        Install app
      </Button>
    </div>
  );
}
