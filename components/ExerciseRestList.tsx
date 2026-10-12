"use client";

import { useExerciseRest } from "@/components/useExerciseRest";
import { api } from "@/convex/_generated/api";
import { formatElapsed } from "@/lib/format";
import { useQuery } from "convex/react";
import { useState } from "react";

/** Rests saved for one exercise. Each wins over the default above until reset. */
export function ExerciseRestList() {
  const overrides = useQuery(api.exercises.restOverrides);
  if (!overrides || overrides.rests.length === 0) {
    return null;
  }
  return (
    <div className="border-t border-line">
      <h3 id="settings-exercise-rests" className="px-4 pt-3 text-sm font-medium text-muted">
        Exercises with their own rest
      </h3>
      <ul aria-labelledby="settings-exercise-rests">
        {overrides.rests.map((rest) => (
          <ExerciseRestRow key={rest._id} name={rest.name} restSeconds={rest.restSeconds} />
        ))}
      </ul>
      {overrides.truncated ? (
        <p className="px-4 pb-3 text-sm text-muted">Showing the first 100.</p>
      ) : null}
    </div>
  );
}

function ExerciseRestRow({ name, restSeconds }: { name: string; restSeconds: number }) {
  const rest = useExerciseRest(name);
  const [cleared, setCleared] = useState(false);
  if (cleared) {
    return null;
  }
  const shown = rest.restSeconds ?? restSeconds;
  return (
    <li className="flex min-h-14 items-center justify-between gap-4 px-4">
      <span className="min-w-0 truncate text-base">{name}</span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="font-mono text-base text-muted tabular-nums">{formatElapsed(shown * 1000)}</span>
        <button
          type="button"
          aria-label={`Reset rest for ${name} to the default`}
          onClick={() => {
            setCleared(true);
            void rest.save(null);
          }}
          className="min-h-11 rounded-full px-3 text-base font-semibold hover:bg-fill-2"
        >
          Reset
        </button>
      </span>
    </li>
  );
}
