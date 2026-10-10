"use client";

import { Button } from "@/components/Button";
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

export function InstallOffer({ className = "" }: { className?: string }) {
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

  if (kind === "ios-hint") {
    return (
      <p className={`text-sm leading-5 text-muted ${className}`}>
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
