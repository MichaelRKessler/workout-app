import assert from "node:assert/strict";
import test from "node:test";
import { NAVIGATION_TIMEOUT_MS, shellCacheName } from "../lib/pwa/cachePolicy.ts";
import { serviceWorkerSource } from "../lib/pwa/serviceWorkerSource.ts";

/**
 * Runs the generated worker against fake caches and a fake network, so the
 * page-load rules are checked as the worker actually runs them.
 */
function loadWorker(network: (request: Request) => Promise<Response>) {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name)!;
    return {
      match: async (request: Request) => entries.get(request.url)?.clone(),
      put: async (request: Request, response: Response) => {
        entries.set(request.url, new Response(await response.text(), { headers: response.headers }));
      },
      keys: async () => [...entries.keys()].map((url) => new Request(url)),
      delete: async (request: Request) => entries.delete(request.url),
    };
  };
  const listeners = new Map<string, (event: unknown) => void>();
  const self = {
    location: { origin: "https://app.test" },
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  const caches = { open, keys: async () => [...stores.keys()], delete: async (name: string) => stores.delete(name) };
  const cacheName = shellCacheName("test");
  new Function("self", "caches", "fetch", serviceWorkerSource(cacheName))(self, caches, network);

  async function load(url: string) {
    const request = new Request(url, { headers: { accept: "text/html" } });
    Object.defineProperty(request, "mode", { value: "navigate" });
    let responded: Promise<Response> | null = null;
    const waits: Promise<unknown>[] = [];
    listeners.get("fetch")!({
      request,
      respondWith: (value: Promise<Response>) => {
        responded = value;
      },
      waitUntil: (value: Promise<unknown>) => waits.push(value),
    });
    assert.ok(responded, "the worker answers page loads");
    return { response: responded as unknown as Promise<Response>, settled: () => Promise.all(waits) };
  }
  const cached = async (url: string) => (await open(cacheName)).match(new Request(url));
  return { load, cached };
}

/** A same-origin answer, as the browser would type it. */
function basic(response: Response): Response {
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}

const html = (body: string) =>
  basic(new Response(`<html>${body}</html>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));

test("a page load uses the network answer and saves a copy for offline", async () => {
  const worker = loadWorker(async () => html("fresh"));
  const first = await worker.load("https://app.test/history");
  assert.equal(await (await first.response).text(), "<html>fresh</html>");
  await first.settled();
  assert.equal(await (await worker.cached("https://app.test/history"))?.text(), "<html>fresh</html>");
});

test("offline, a page load falls back to the saved copy", async () => {
  let online = true;
  const worker = loadWorker(async () => {
    if (!online) throw new TypeError("Failed to fetch");
    return html("saved");
  });
  await (await worker.load("https://app.test/")).settled();
  online = false;
  const { response } = await worker.load("https://app.test/");
  assert.equal(await (await response).text(), "<html>saved</html>");
});

test("a slow network shows the saved copy after the timeout, then refreshes it", async (t) => {
  let release: (response: Response) => void = () => undefined;
  let slow = false;
  const worker = loadWorker(async () => {
    if (!slow) return html("v1");
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  });
  await (await worker.load("https://app.test/")).settled();

  t.mock.timers.enable({ apis: ["setTimeout"] });
  slow = true;
  const load = await worker.load("https://app.test/");
  let answer: Response | null = null;
  void load.response.then((value) => {
    answer = value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(NAVIGATION_TIMEOUT_MS - 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(answer, null, "waits for the network before the timeout");
  t.mock.timers.tick(1);
  for (let i = 0; i < 5 && !answer; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(answer, "the saved copy is shown after the timeout");
  assert.equal(await (answer as Response).text(), "<html>v1</html>");
  t.mock.timers.reset();

  release(html("v2"));
  await load.settled();
  assert.equal(await (await worker.cached("https://app.test/"))?.text(), "<html>v2</html>");
});

test("a slow network with nothing saved keeps waiting for the network", async (t) => {
  let release: (response: Response) => void = () => undefined;
  const worker = loadWorker(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const load = await worker.load("https://app.test/body");
  t.mock.timers.tick(NAVIGATION_TIMEOUT_MS * 3);
  t.mock.timers.reset();
  release(html("late"));
  assert.equal(await (await load.response).text(), "<html>late</html>");
});

test("the page gets the network answer before its body has finished downloading", async () => {
  let push: (chunk: string) => void = () => undefined;
  let end: () => void = () => undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      push = (chunk) => controller.enqueue(encoder.encode(chunk));
      end = () => controller.close();
    },
  });
  const worker = loadWorker(async () =>
    basic(new Response(body, { status: 200, headers: { "content-type": "text/html" } })),
  );
  push("<html>start");
  const load = await worker.load("https://app.test/");
  const response = await load.response;
  assert.equal(response.status, 200, "answered while the body is still streaming");
  push("end</html>");
  end();
  assert.equal(await response.text(), "<html>startend</html>");
  await load.settled();
  assert.equal(await (await worker.cached("https://app.test/"))?.text(), "<html>startend</html>");
});

test("signed-in pages are saved without the login token", async () => {
  const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJlMTIz";
  const worker = loadWorker(async () => html(`{"token":"${token}","_timeFetched":42}`));
  const load = await worker.load("https://app.test/");
  assert.match(await (await load.response).text(), /eyJ/);
  await load.settled();
  const saved = await (await worker.cached("https://app.test/"))?.text();
  assert.equal(saved?.includes(token), false);
});
