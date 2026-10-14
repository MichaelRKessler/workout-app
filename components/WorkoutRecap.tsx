"use client";

import type { EarnedBadge, Recap } from "@/convex/lib/recap";
import type { WeightUnit } from "@/convex/lib/units";
import { pluralize } from "@/lib/format";
import { badgeInfo, celebrationText, highlightText } from "@/lib/recapText";
import type { CSSProperties } from "react";

const SHELF_PREVIEW = 6;

function rise(index: number): CSSProperties {
  return { animation: `recap-rise 420ms ${120 + index * 110}ms ease-out both` };
}

/** Highlights and personal bests for the finished-workout screen. */
export function WorkoutRecap({
  recap,
  names,
  unit,
}: {
  recap: Recap;
  names: Record<string, string>;
  unit: WeightUnit;
}) {
  const fresh = recap.badges.filter((badge) => badge.isNew);
  return (
    <div className="flex flex-col gap-4">
      {fresh.length > 0 ? (
        <section aria-label="New badges" className="flex flex-col gap-2">
          {fresh.map((badge, index) => (
            <NewBadge key={`${badge.id}:${badge.exerciseId ?? ""}`} badge={badge} names={names} index={index} />
          ))}
        </section>
      ) : null}
      {recap.highlights.length > 0 ? (
        <section aria-label="Highlights">
          <ul className="flex flex-col gap-2.5">
            {recap.highlights.map((item, index) => {
              const line = highlightText(item, unit, names, recap.seed);
              return (
                <li key={`${item.kind}-${index}`} className="flex gap-3" style={rise(index)}>
                  <span aria-hidden="true" className="text-xl leading-snug">
                    {line.icon}
                  </span>
                  <span className="text-base leading-snug text-pretty">{line.text}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {recap.celebrations.length > 0 ? (
        <section
          aria-label="Personal bests"
          className="rounded-[1.25rem] border border-accent/40 bg-accent/5 px-4 py-3.5"
        >
          <h2 className="text-xs font-medium tracking-[0.06em] text-accent-ink uppercase">
            {recap.celebrations.some((item) => item.kind !== "beatLastTime")
              ? "Personal bests"
              : "Better than last time"}
          </h2>
          <ul className="mt-1.5 flex flex-col gap-1">
            {recap.celebrations.map((item, index) => (
              <li
                key={`${item.kind}-${index}`}
                className="text-[0.9375rem] leading-snug text-pretty"
                style={rise(recap.highlights.length + index)}
              >
                {celebrationText(item, unit, names)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function NewBadge({ badge, names, index }: { badge: EarnedBadge; names: Record<string, string>; index: number }) {
  const info = badgeInfo(badge, names);
  return (
    <div className="flex items-center gap-3.5 rounded-[1.25rem] bg-inverse px-4 py-3.5 text-inverse-ink">
      <span
        aria-hidden="true"
        className="text-4xl leading-none"
        style={{ animation: `badge-pop 650ms ${250 + index * 180}ms cubic-bezier(0.2, 0.9, 0.3, 1.3) both` }}
      >
        {info.emoji}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium tracking-[0.06em] uppercase opacity-75">Badge unlocked</p>
        <p className="text-lg leading-tight font-semibold">{info.title}</p>
        <p className="text-sm opacity-80">{info.description}</p>
      </div>
    </div>
  );
}

/**
 * Every badge earned so far, without fanfare. Badges from older history show
 * here the first time and never pop up.
 */
export function BadgeShelf({ badges, names }: { badges: EarnedBadge[]; names: Record<string, string> }) {
  if (badges.length === 0) {
    return null;
  }
  const preview = badges.slice(0, SHELF_PREVIEW);
  const rest = badges.slice(SHELF_PREVIEW);
  return (
    <section aria-label="Your badges" className="mt-7">
      <h2 className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">
        Your badges · {badges.length}
      </h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {preview.map((badge) => (
          <BadgeChip key={`${badge.id}:${badge.exerciseId ?? ""}`} badge={badge} names={names} />
        ))}
      </ul>
      {rest.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-muted">{pluralize(rest.length, "more badge")}</summary>
          <ul className="mt-2 flex flex-wrap gap-2">
            {rest.map((badge) => (
              <BadgeChip key={`${badge.id}:${badge.exerciseId ?? ""}`} badge={badge} names={names} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function BadgeChip({ badge, names }: { badge: EarnedBadge; names: Record<string, string> }) {
  const info = badgeInfo(badge, names);
  return (
    <li
      title={info.description}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-sm"
    >
      <span aria-hidden="true">{info.emoji}</span>
      <span>{info.title}</span>
    </li>
  );
}
