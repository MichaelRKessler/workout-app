/**
 * Chrome DevTools installability check against a running production server.
 *
 * Usage: node scripts/check-installability.mjs http://127.0.0.1:3000
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pageUrl = process.argv[2] ?? "http://127.0.0.1:3000";
const port = 9222;
const profile = await mkdtemp(join(tmpdir(), "workout-pwa-"));

const chrome = spawn(
  "google-chrome",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

let chromeLog = "";
chrome.stderr.on("data", (chunk) => {
  chromeLog += chunk.toString();
});

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForBrowser() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Chrome is still starting.
    }
    await sleep(100);
  }
  throw new Error(`Chrome did not open a DevTools port.\n${chromeLog}`);
}

try {
  const version = await waitForBrowser();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const events = [];

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(JSON.stringify(message.error)));
      } else {
        resolve(message.result);
      }
      return;
    }
    if (message.method) {
      events.push(message);
    }
  });

  function send(method, params = {}, sessionId) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (sessionId) {
        payload.sessionId = sessionId;
      }
      ws.send(JSON.stringify(payload));
    });
  }

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send(
    "Page.addScriptToEvaluateOnNewDocument",
    {
      source: `window.__installPromptSeen=false;window.addEventListener("beforeinstallprompt",function(){window.__installPromptSeen=true;});`,
    },
    sessionId,
  );

  const loaded = new Promise((resolve) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (
        message.method === "Page.loadEventFired" &&
        message.sessionId === sessionId
      ) {
        ws.removeEventListener("message", onMessage);
        resolve();
      }
    };
    ws.addEventListener("message", onMessage);
  });
  await send("Page.navigate", { url: pageUrl }, sessionId);
  await loaded;

  let manifest = null;
  let installability = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    manifest = await send("Page.getAppManifest", {}, sessionId);
    installability = await send("Page.getInstallabilityErrors", {}, sessionId);
    if (manifest?.data && installability) {
      const errors = installability.installabilityErrors ?? [];
      if (errors.length === 0) {
        break;
      }
    }
    await sleep(250);
  }

  await sleep(500);
  const evaluated = await send(
    "Runtime.evaluate",
    {
      expression: `({
        installPromptSeen: window.__installPromptSeen === true,
        deferredInstall: window.__deferredInstallPrompt == null ? window.__deferredInstallPrompt : "captured",
        manifestHref: document.querySelector('link[rel="manifest"]')?.href ?? null,
        themeColor: document.querySelector('meta[name="theme-color"]')?.content ?? null,
        mobileCapable: document.querySelector('meta[name="mobile-web-app-capable"]')?.content ?? null,
        appleCapable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content ?? null,
        appleTouchIcon: document.querySelector('link[rel="apple-touch-icon"]')?.href ?? null,
        serviceWorkerController: navigator.serviceWorker?.controller ? "controlled" : "none"
      })`,
      returnByValue: true,
    },
    sessionId,
  );

  const report = {
    url: pageUrl,
    manifest: manifest
      ? {
          url: manifest.url,
          errors: manifest.errors,
          parsed: manifest.data ? JSON.parse(manifest.data) : null,
        }
      : null,
    installabilityErrors: installability?.installabilityErrors ?? null,
    page: evaluated.result?.value ?? evaluated,
  };
  console.log(JSON.stringify(report, null, 2));

  const errors = report.installabilityErrors ?? [];
  if (!report.manifest?.parsed) {
    throw new Error("Chrome did not parse a web app manifest");
  }
  if (errors.length > 0) {
    throw new Error(
      `Installability errors: ${errors.map((error) => error.errorId).join(", ")}`,
    );
  }
  if (report.page?.deferredInstall !== "captured") {
    throw new Error("beforeinstallprompt was not captured for the Install app button");
  }
  const controller = report.page?.serviceWorkerController;
  if (controller !== "none" && controller !== "controlled") {
    throw new Error(`Unexpected service worker state: ${String(controller)}`);
  }
  ws.close();
} finally {
  chrome.kill();
  await sleep(300);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
