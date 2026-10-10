export type InstallOfferKind = "hidden" | "install" | "ios-hint";

export type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

declare global {
  interface Window {
    __deferredInstallPrompt?: DeferredInstallPrompt | null;
  }

  interface WindowEventMap {
    "pwa-installable": Event;
    "pwa-installed": Event;
  }
}

export function installOffer(input: {
  installed: boolean;
  promptAvailable: boolean;
  iosSafari: boolean;
}): InstallOfferKind {
  if (input.installed) {
    return "hidden";
  }
  if (input.promptAvailable) {
    return "install";
  }
  if (input.iosSafari) {
    return "ios-hint";
  }
  return "hidden";
}

export function isRunningInstalled(input: {
  standalone: boolean;
  navigatorStandalone: boolean;
}): boolean {
  return input.standalone || input.navigatorStandalone;
}

export function isIosSafari(input: {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}): boolean {
  const ua = input.userAgent;
  if (/CriOS|FxiOS|EdgiOS|OPiOS|Android/.test(ua)) {
    return false;
  }
  const iphone = /iPhone|iPod/.test(ua);
  const ipad = /iPad/.test(ua);
  const ipadOsDesktopUa =
    input.platform === "MacIntel" &&
    input.maxTouchPoints > 1 &&
    /Macintosh/.test(ua);
  if (!iphone && !ipad && !ipadOsDesktopUa) {
    return false;
  }
  if (!/Safari/.test(ua)) {
    return false;
  }
  if (/Chrome|Chromium|Firefox|Edg\//.test(ua)) {
    return false;
  }
  return true;
}
