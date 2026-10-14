"use client";

import { useOfflineLog } from "@/components/OfflineSync";
import { BodyIcon, DumbbellIcon, HistoryIcon, HomeIcon, MicIcon, PlusIcon } from "@/components/icons";
import { api } from "@/convex/_generated/api";
import { activeTab, LOG_EVENT, LOG_PARAM, type TabKey } from "@/lib/tabBar";
import { useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentType } from "react";

type Tab = { key: TabKey; href: string; label: string; Icon: ComponentType<{ className?: string }> };

/** The bar along the bottom of every signed-in page, with the mic in the middle. */
export function TabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { offline, snapshot } = useOfflineLog();
  const openSession = useQuery(api.sessions.getOpen);
  const inWorkout = openSession !== undefined ? openSession !== null : Boolean(snapshot?.session);

  return (
    <TabBarView
      pathname={pathname}
      inWorkout={inWorkout}
      offline={offline}
      onLog={() => {
        if (pathname === "/") {
          window.dispatchEvent(new Event(LOG_EVENT));
        } else {
          router.push(`/?${LOG_PARAM}=1`);
        }
      }}
    />
  );
}

export function TabBarView({
  pathname,
  inWorkout,
  offline,
  onLog,
}: {
  pathname: string;
  /** Home turns into "Workout", with a dot, while one is open. */
  inWorkout: boolean;
  /** Offline the center button adds a set by hand, since voice needs a connection. */
  offline: boolean;
  onLog: () => void;
}) {
  const current = activeTab(pathname);
  const left: Tab[] = [
    { key: "home", href: "/", label: inWorkout ? "Workout" : "Home", Icon: HomeIcon },
    { key: "history", href: "/history", label: "History", Icon: HistoryIcon },
  ];
  const right: Tab[] = [
    { key: "exercises", href: "/exercises", label: "Exercises", Icon: DumbbellIcon },
    { key: "body", href: "/body", label: "Body", Icon: BodyIcon },
  ];

  const renderTab = (tab: Tab) => {
    const active = current === tab.key;
    return (
      <Link
        key={tab.key}
        href={tab.href}
        aria-current={active ? "page" : undefined}
        className={`relative flex min-w-0 flex-col items-center justify-center gap-1 text-xs leading-none ${
          active ? "font-semibold text-foreground" : "font-medium text-subtle hover:text-foreground"
        }`}
      >
        <tab.Icon className="size-6" />
        {tab.label}
        {tab.key === "home" && inWorkout ? (
          <span aria-hidden="true" className="absolute top-2 left-[calc(50%+8px)] size-2 rounded-full bg-accent" />
        ) : null}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto grid h-[4.5rem] max-w-lg grid-cols-5 px-1">
        {left.map(renderTab)}
        <div className="relative flex justify-center">
          <button
            type="button"
            onClick={onLog}
            aria-label={offline ? "Add a set by hand" : "Log a set by voice"}
            className="absolute -top-6 flex size-16 items-center justify-center rounded-full border-4 border-background bg-inverse text-inverse-ink shadow-lift transition active:scale-[0.97]"
          >
            {offline ? <PlusIcon className="size-7" /> : <MicIcon className="size-7" strokeWidth={1.7} />}
          </button>
          <span aria-hidden="true" className="mt-auto mb-3 text-xs leading-none font-medium text-subtle">
            Log
          </span>
        </div>
        {right.map(renderTab)}
      </div>
    </nav>
  );
}
