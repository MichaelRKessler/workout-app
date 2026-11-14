// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const auth = { isLoading: true, isAuthenticated: false };
let status: unknown = undefined;
let offline = false;
const syncProps: Array<{ email: string | null; autoSync?: boolean }> = [];

vi.mock("convex/react", () => ({
  useConvexAuth: () => auth,
  useQuery: (_ref: unknown, args: unknown) => (args === "skip" ? undefined : status),
  useMutation: () => vi.fn(async () => undefined),
}));
vi.mock("@/components/useConnectivity", () => ({ useConnectivity: () => ({ offline }) }));
vi.mock("@/components/TabBar", () => ({ TabBar: () => <nav aria-label="Main" /> }));
vi.mock("@/components/WeightUnit", () => ({ WeightUnitProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/OfflineSync", () => ({
  OfflineBanner: () => null,
  OfflineSyncProvider: (props: { email: string | null; autoSync?: boolean; children: React.ReactNode }) => {
    syncProps.push({ email: props.email, autoSync: props.autoSync });
    return props.children;
  },
}));
vi.mock("@/components/NoAccess", () => ({ NoAccess: () => <p>No access yet</p> }));
vi.mock("@/lib/pwa/clearShellCache", () => ({ clearShellCache: async () => undefined }));

const { AppShell } = await import("@/components/AppShell");

const access = { email: "lifter@example.com", name: "Lifter", allowed: true, isAdmin: false, request: null };

beforeEach(() => {
  localStorage.clear();
  auth.isLoading = true;
  auth.isAuthenticated = false;
  status = undefined;
  offline = false;
  syncProps.length = 0;
});

afterEach(() => {
  cleanup();
});

test("a first launch waits for the sign-in check", () => {
  render(<AppShell><p>Home</p></AppShell>);
  expect(screen.getByText("Loading your workouts…")).toBeTruthy();
  expect(screen.queryByText("Home")).toBeNull();
});

test("a returning user sees the app while the sign-in check runs, and no sign-in screen", async () => {
  localStorage.setItem("workout-offline:access", JSON.stringify(access));
  render(<AppShell><p>Home</p></AppShell>);
  expect(await screen.findByText("Home")).toBeTruthy();
  expect(screen.queryByText("Sign in to log a workout.")).toBeNull();
  // Queued changes wait until the server confirms who is signed in.
  expect(syncProps.at(-1)).toEqual({ email: "lifter@example.com", autoSync: false });
});

test("once the server answers, queued changes sync", async () => {
  localStorage.setItem("workout-offline:access", JSON.stringify(access));
  const view = render(<AppShell><p>Home</p></AppShell>);
  await screen.findByText("Home");
  auth.isLoading = false;
  auth.isAuthenticated = true;
  status = access;
  view.rerender(<AppShell><p>Home</p></AppShell>);
  expect(syncProps.at(-1)).toEqual({ email: "lifter@example.com", autoSync: true });
});

test("offline, a relaunch opens the app from the cached access", async () => {
  localStorage.setItem("workout-offline:access", JSON.stringify(access));
  offline = true;
  render(<AppShell><p>Home</p></AppShell>);
  expect(await screen.findByText("Home")).toBeTruthy();
  expect(syncProps.at(-1)?.autoSync).toBe(true);
});

test("a signed-out answer still shows the sign-in screen", async () => {
  localStorage.setItem("workout-offline:access", JSON.stringify(access));
  auth.isLoading = false;
  auth.isAuthenticated = false;
  render(<AppShell><p>Home</p></AppShell>);
  expect(await screen.findByText("Sign in to log a workout.")).toBeTruthy();
  expect(screen.queryByText("Home")).toBeNull();
});

test("cached access that was refused still shows the no-access screen first", async () => {
  localStorage.setItem("workout-offline:access", JSON.stringify({ ...access, allowed: false }));
  render(<AppShell><p>Home</p></AppShell>);
  expect(await screen.findByText("No access yet")).toBeTruthy();
  expect(screen.queryByText("Home")).toBeNull();
});
