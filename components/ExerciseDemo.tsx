"use client";

import { Button } from "@/components/Button";
import { Sheet } from "@/components/Sheet";
import { prefersReducedMotion } from "@/components/workout/Confetti";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  demoImageUrls,
  demoWords,
  findDemo,
  matchDemo,
  NO_DEMO,
  videoSearchUrl,
  type DemoEntry,
} from "@/lib/demos/match";
import { readableError } from "@/lib/errors";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useId, useMemo, useState } from "react";

// The catalogue is about 680 KB, so it loads on first use instead of riding in
// the workout screen's bundle. Every mounted demo shares the one download.
let cached: DemoEntry[] | null = null;
let pending: Promise<DemoEntry[]> | null = null;

function useDemoCatalogue(): DemoEntry[] | null {
  const [catalogue, setCatalogue] = useState<DemoEntry[] | null>(cached);
  useEffect(() => {
    if (cached) {
      return;
    }
    let alive = true;
    pending ??= import("@/lib/demos/catalogue.json").then(
      (module) => (cached = module.default as DemoEntry[]),
    );
    pending.then(
      (loaded) => {
        if (alive) {
          setCatalogue(loaded);
        }
      },
      () => {
        pending = null;
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return catalogue;
}

type Resolved =
  | { state: "loading" }
  | { state: "ready"; entry: DemoEntry | null; source: "saved" | "matched" | "none" };

function useResolvedDemo(exerciseId: string, name: string): Resolved & { catalogue: DemoEntry[] | null } {
  const choice = useQuery(api.exercises.demoChoice, { exerciseId });
  const catalogue = useDemoCatalogue();
  if (choice === undefined || catalogue === null) {
    return { state: "loading", catalogue };
  }
  const saved = choice?.demoId ?? null;
  if (saved === NO_DEMO) {
    return { state: "ready", entry: null, source: "none", catalogue };
  }
  const savedEntry = saved ? findDemo(saved, catalogue) : null;
  if (savedEntry) {
    return { state: "ready", entry: savedEntry, source: "saved", catalogue };
  }
  return { state: "ready", entry: matchDemo(name, catalogue), source: "matched", catalogue };
}

/**
 * Start and end photos that swap about once a second, which reads as a slow
 * animation. Tapping swaps by hand and stops the loop. With reduced motion the
 * loop never starts.
 */
function DemoPhotos({ entry, className }: { entry: DemoEntry; className: string }) {
  const [frame, setFrame] = useState(0);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  const urls = demoImageUrls(entry.id);

  useEffect(() => {
    if (paused || prefersReducedMotion()) {
      return;
    }
    const timer = window.setInterval(() => setFrame((current) => 1 - current), 1100);
    return () => window.clearInterval(timer);
  }, [paused]);

  if (failed) {
    return (
      <p className="text-sm text-muted">The demo photos didn&apos;t load. They need a connection.</p>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setPaused(true);
        setFrame((current) => 1 - current);
      }}
      aria-label={frame === 0 ? `Show end position of ${entry.name}` : `Show start position of ${entry.name}`}
      className={`relative block overflow-hidden rounded-xl border border-line bg-white ${className}`}
    >
      {urls.map((url, index) => (
        // Photos come from a CDN outside Next's image optimizer, so a plain img.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={url}
          src={url}
          alt={index === 0 ? `${entry.name}, start position` : `${entry.name}, end position`}
          aria-hidden={index !== frame}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${
            index === frame ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}
    </button>
  );
}

function DemoSteps({ entry }: { entry: DemoEntry }) {
  if (entry.steps.length === 0) {
    return null;
  }
  return (
    <details className="mt-3 text-base">
      <summary className="min-h-11 cursor-pointer py-2 font-medium">How to do it</summary>
      <ol className="list-decimal space-y-1.5 pl-5 leading-normal text-muted">
        {entry.steps.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
    </details>
  );
}

function VideoLink({ name }: { name: string }) {
  return (
    <a
      href={videoSearchUrl(name)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center text-base font-medium underline decoration-line underline-offset-4 hover:decoration-current"
    >
      Watch a video
    </a>
  );
}

/** Demo section on the exercise page, with a picker to fix the match. */
export function ExerciseDemo({
  exerciseId,
  name,
  offline = false,
}: {
  exerciseId: Id<"exercises">;
  name: string;
  offline?: boolean;
}) {
  const resolved = useResolvedDemo(exerciseId, name);
  const [picking, setPicking] = useState(false);

  if (resolved.state === "loading") {
    return null;
  }
  const { entry, source } = resolved;

  return (
    <section className="mt-4" aria-label="Demo">
      <h2 className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">Demo</h2>
      {entry ? (
        <>
          <DemoPhotos key={entry.id} entry={entry} className="mt-2 aspect-[4/3] w-full max-w-sm" />
          <p className="mt-1.5 text-sm text-muted">
            {source === "saved" ? entry.name : `Matched: ${entry.name}`}
          </p>
          <DemoSteps entry={entry} />
        </>
      ) : (
        <p className="mt-2 text-base text-muted">
          {source === "none" ? "Demo turned off for this exercise." : "No demo found for this name."}
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-5">
        <VideoLink name={name} />
        <button
          type="button"
          onClick={() => setPicking(true)}
          disabled={offline}
          className="min-h-11 text-base font-medium text-muted underline decoration-line underline-offset-4 hover:decoration-current disabled:opacity-50"
        >
          {entry ? "Wrong demo?" : "Pick a demo"}
        </button>
      </div>
      {resolved.catalogue ? (
        <DemoPicker
          open={picking}
          onClose={() => setPicking(false)}
          exerciseId={exerciseId}
          name={name}
          catalogue={resolved.catalogue}
          source={source}
        />
      ) : null}
    </section>
  );
}

const RESULT_LIMIT = 40;

function DemoPicker({
  open,
  onClose,
  exerciseId,
  name,
  catalogue,
  source,
}: {
  open: boolean;
  onClose: () => void;
  exerciseId: Id<"exercises">;
  name: string;
  catalogue: DemoEntry[];
  source: "saved" | "matched" | "none";
}) {
  const setDemo = useMutation(api.exercises.setDemo);
  const [query, setQuery] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();

  const results = useMemo(() => {
    const words = demoWords(query);
    if (words.length === 0) {
      return [];
    }
    // Entries holding every typed word first, then those holding most of them.
    return catalogue
      .map((entry) => {
        const entryWords = demoWords(entry.name);
        const hits = words.filter((word) => entryWords.some((candidate) => candidate.startsWith(word))).length;
        return { entry, hits };
      })
      .filter((item) => item.hits > 0)
      .sort((left, right) => right.hits - left.hits || left.entry.name.length - right.entry.name.length)
      .slice(0, RESULT_LIMIT)
      .map((item) => item.entry);
  }, [catalogue, query]);

  async function choose(demoId: string | null) {
    if (saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setDemo({ exerciseId, demoId });
      onClose();
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} labelledBy={titleId} dismissible={!saving}>
      <h2 id={titleId} className="mt-2 text-xl font-semibold tracking-[-0.02em]">
        Demo for {name}
      </h2>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search demos"
        placeholder="Search demos"
        className="mt-3 h-12 w-full rounded-xl border border-input bg-background px-3 text-base outline-none focus:border-foreground"
      />
      <ul className="mt-2 flex flex-col" aria-label="Demos">
        {results.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              disabled={saving}
              onClick={() => void choose(entry.id)}
              className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-line text-left text-base disabled:opacity-60"
            >
              <span>{entry.name}</span>
              {entry.equipment ? <span className="shrink-0 text-sm text-subtle">{entry.equipment}</span> : null}
            </button>
          </li>
        ))}
        {results.length === 0 ? <li className="py-3 text-base text-muted">No demos match.</li> : null}
      </ul>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex gap-2.5">
        {source !== "matched" ? (
          <Button variant="secondary" className="flex-1" disabled={saving} onClick={() => void choose(null)}>
            Match from name
          </Button>
        ) : null}
        {source !== "none" ? (
          <Button variant="secondary" className="flex-1" disabled={saving} onClick={() => void choose(NO_DEMO)}>
            No demo
          </Button>
        ) : null}
      </div>
    </Sheet>
  );
}

/** Collapsed "How to" toggle for the guided workout card. */
export function GuidedDemo({ exerciseId, name }: { exerciseId: string | null; name: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="min-h-11 text-base font-medium text-muted underline decoration-line underline-offset-4 hover:decoration-current"
      >
        {open ? "Hide demo" : "Show demo"}
      </button>
      {open ? (
        <div id={panelId}>
          {exerciseId ? <GuidedDemoPanel exerciseId={exerciseId} name={name} /> : <VideoLink name={name} />}
        </div>
      ) : null}
    </div>
  );
}

function GuidedDemoPanel({ exerciseId, name }: { exerciseId: string; name: string }) {
  const resolved = useResolvedDemo(exerciseId, name);
  if (resolved.state === "loading") {
    return <p className="text-sm text-muted">Loading demo…</p>;
  }
  return (
    <>
      {resolved.entry ? (
        <>
          <DemoPhotos key={resolved.entry.id} entry={resolved.entry} className="mt-1 aspect-[4/3] w-full" />
          <DemoSteps entry={resolved.entry} />
        </>
      ) : null}
      <VideoLink name={name} />
    </>
  );
}
