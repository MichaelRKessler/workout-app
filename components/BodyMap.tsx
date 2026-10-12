"use client";

import { MUSCLE_LABELS, type MuscleGroup } from "@/convex/lib/muscleGroup";
import type { BodyView } from "@/lib/bodyMap/paths";
import { muscleLevels, REGION_GROUP, type BodyRegion, type MuscleLevel } from "@/lib/bodyMap/regions";
import { pluralize } from "@/lib/format";
import { useEffect, useState, type KeyboardEvent } from "react";

type BodyPaths = { front: BodyView; back: BodyView };

// The outlines are about 45 KB, so they load on first use instead of riding in
// the home screen's bundle. Every mounted map shares the one download.
let cached: BodyPaths | null = null;
let pending: Promise<BodyPaths> | null = null;

function useBodyPaths(): BodyPaths | null {
  const [paths, setPaths] = useState<BodyPaths | null>(cached);
  useEffect(() => {
    if (cached) {
      return;
    }
    let alive = true;
    pending ??= import("@/lib/bodyMap/paths").then((module) => (cached = module.default));
    pending.then(
      (loaded) => {
        if (alive) {
          setPaths(loaded);
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
  return paths;
}

const SILHOUETTE = "var(--line-soft)";

/** Step 0 is a muscle with no sets this week; 1 to 4 deepen toward the accent. */
const LEVEL_FILL: Record<MuscleLevel, string> = {
  0: "var(--line)",
  1: "color-mix(in oklab, var(--accent) 30%, var(--line))",
  2: "color-mix(in oklab, var(--accent) 52%, var(--line))",
  3: "color-mix(in oklab, var(--accent) 76%, var(--line))",
  4: "var(--accent)",
};

function View({
  view,
  label,
  levels,
  sets,
  onSelect,
  repeated,
}: {
  view: BodyView;
  label: string;
  levels: Map<MuscleGroup, MuscleLevel>;
  sets: Map<MuscleGroup, number>;
  onSelect?: (group: MuscleGroup) => void;
  /** Groups the other view already offers as a button; still tappable, but one tab stop each. */
  repeated?: ReadonlySet<MuscleGroup>;
}) {
  const silhouette: string[] = [];
  const byGroup = new Map<MuscleGroup, string[]>();
  for (const [region, paths] of Object.entries(view.regions) as Array<[BodyRegion, readonly string[]]>) {
    const group = REGION_GROUP[region];
    if (!group) {
      silhouette.push(...paths);
      continue;
    }
    byGroup.set(group, [...(byGroup.get(group) ?? []), ...paths]);
  }

  function onKey(event: KeyboardEvent<SVGGElement>, group: MuscleGroup) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect?.(group);
    }
  }

  return (
    <svg
      viewBox={view.viewBox}
      className="h-full w-auto"
      // A surface-coloured edge keeps neighbouring muscles apart in both themes.
      style={{ stroke: "var(--surface)", strokeWidth: 3, strokeLinejoin: "round" }}
      role={onSelect ? "group" : "img"}
      aria-label={label}
    >
      {silhouette.map((d, index) => (
        <path key={`s${index}`} d={d} style={{ fill: SILHOUETTE }} />
      ))}
      {[...byGroup].map(([group, paths]) => {
        const name = `${MUSCLE_LABELS[group]}, ${pluralize(sets.get(group) ?? 0, "set")}`;
        const button = Boolean(onSelect) && !repeated?.has(group);
        return (
          <g
            key={group}
            data-group={group}
            style={{ fill: LEVEL_FILL[levels.get(group) ?? 0] }}
            className={onSelect ? "cursor-pointer outline-none focus-visible:opacity-70" : undefined}
            role={button ? "button" : undefined}
            tabIndex={button ? 0 : undefined}
            aria-label={button ? name : undefined}
            aria-hidden={onSelect && !button ? true : undefined}
            onClick={onSelect ? () => onSelect(group) : undefined}
            onKeyDown={onSelect ? (event) => onKey(event, group) : undefined}
          >
            <title>{name}</title>
            {paths.map((d, index) => (
              <path key={index} d={d} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function frontGroups(view: BodyView): Set<MuscleGroup> {
  const groups = new Set<MuscleGroup>();
  for (const region of Object.keys(view.regions) as BodyRegion[]) {
    const group = REGION_GROUP[region];
    if (group) {
      groups.add(group);
    }
  }
  return groups;
}

/**
 * Front and back of a body, each muscle group shaded by its working sets
 * relative to the most-trained group. Tapping a group calls `onSelect`.
 */
export function BodyMap({
  muscles,
  onSelect,
  className = "h-48",
}: {
  muscles: ReadonlyArray<{ group: MuscleGroup; sets: number }>;
  onSelect?: (group: MuscleGroup) => void;
  className?: string;
}) {
  const paths = useBodyPaths();
  const levels = muscleLevels(muscles);
  const sets = new Map<MuscleGroup, number>();
  for (const item of muscles) {
    sets.set(item.group, (sets.get(item.group) ?? 0) + item.sets);
  }
  return (
    <div className={`flex justify-center gap-4 ${className}`}>
      {paths ? (
        <>
          <View view={paths.front} label="Front" levels={levels} sets={sets} onSelect={onSelect} />
          <View
            view={paths.back}
            label="Back"
            levels={levels}
            sets={sets}
            onSelect={onSelect}
            repeated={frontGroups(paths.front)}
          />
        </>
      ) : null}
    </div>
  );
}
