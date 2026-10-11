"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { api } from "@/convex/_generated/api";
import { formatLongDate, formatMonthHeading } from "@/lib/format";
import {
  calendarDayBounds,
  calendarDayKey,
  civilMonth,
  markedDayKeys,
  monthCells,
  monthWindow,
  shiftMonth,
  weekdayIndex,
  type CalendarCell,
} from "@/lib/historyDays";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Month of finished workouts. Training days open the combined day view.
 * Weeks start on Sunday. Arrows and a horizontal swipe change the month.
 */
export function HistoryCalendar({ timeZone }: { timeZone: string }) {
  const [cursor, setCursor] = useState(() => civilMonth(Date.now(), timeZone));
  const [todayKey, setTodayKey] = useState<string | null>(null);
  const gesture = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setTodayKey(calendarDayKey(Date.now(), timeZone));
  }, [timeZone]);

  const bounds = monthWindow(cursor.year, cursor.month, timeZone);
  const month = useQuery(
    api.sessions.calendar,
    bounds ? { startedFrom: bounds.start, startedUntil: bounds.end } : "skip",
  );
  const cells = monthCells(cursor.year, cursor.month, timeZone);
  const marks = markedDayKeys(month?.startedAts ?? [], timeZone);
  const headingStamp = bounds?.start ?? Date.now();
  const current = civilMonth(Date.now(), timeZone);
  const atCurrent = cursor.year === current.year && cursor.month === current.month;
  const atFloor = cursor.year <= 2000 && cursor.month === 1;

  function move(delta: number) {
    setCursor((value) => {
      const next = shiftMonth(value.year, value.month, delta);
      if (next.year < 2000) {
        return value;
      }
      if (delta > 0 && (next.year > current.year || (next.year === current.year && next.month > current.month))) {
        return value;
      }
      return next;
    });
  }

  return (
    <section aria-label="Workout calendar" className="mt-6">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => move(-1)}
          disabled={atFloor}
          className="flex size-11 items-center justify-center rounded-full text-foreground hover:bg-fill-2 disabled:text-subtle"
        >
          <ChevronLeftIcon className="size-6" strokeWidth={1.8} />
        </button>
        <h2 className="min-w-0 truncate text-center text-lg font-semibold tracking-[-0.02em]" suppressHydrationWarning>
          {formatMonthHeading(headingStamp, Date.now())}
        </h2>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => move(1)}
          disabled={atCurrent}
          className="flex size-11 items-center justify-center rounded-full text-foreground hover:bg-fill-2 disabled:text-subtle"
        >
          <ChevronRightIcon className="size-6" strokeWidth={1.8} />
        </button>
      </div>

      <div
        className="mt-3"
        onTouchStart={(event) => {
          const touch = event.changedTouches[0];
          if (!touch) {
            return;
          }
          gesture.current = { x: touch.clientX, y: touch.clientY };
        }}
        onTouchEnd={(event) => {
          const touch = event.changedTouches[0];
          const origin = gesture.current;
          gesture.current = null;
          if (!touch || !origin) {
            return;
          }
          const dx = touch.clientX - origin.x;
          const dy = touch.clientY - origin.y;
          if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) {
            return;
          }
          move(dx < 0 ? 1 : -1);
        }}
      >
        <div className="grid grid-cols-7" aria-hidden="true">
          {WEEKDAYS.map((name) => (
            <span key={name} className="flex h-8 items-center justify-center text-xs text-subtle">
              {name.slice(0, 1)}
            </span>
          ))}
        </div>
        {cells ? (
          <div className="grid grid-cols-7">
            {cells.map((cell) => (
              <DayCell
                key={cell.dayKey}
                cell={cell}
                count={marks.get(cell.dayKey) ?? 0}
                today={cell.dayKey === todayKey}
                timeZone={timeZone}
              />
            ))}
          </div>
        ) : (
          <p className="mt-4 text-base text-muted">That month is not a calendar month.</p>
        )}
      </div>

      {month === undefined ? <p className="mt-4 text-base text-muted">Loading this month…</p> : null}
      {month && month.startedAts.length === 0 ? (
        <p className="mt-4 text-base text-muted">No workouts this month.</p>
      ) : null}
      {month?.truncated ? (
        <p className="mt-2 text-sm text-pretty text-subtle">
          This month has more than 120 workouts. Earlier ones in the month are not marked.
        </p>
      ) : null}
    </section>
  );
}

function DayCell({
  cell,
  count,
  today,
  timeZone,
}: {
  cell: CalendarCell;
  count: number;
  today: boolean;
  timeZone: string;
}) {
  if (!cell.inMonth) {
    return <span className="mx-auto block size-10" />;
  }
  const bounds = calendarDayBounds(cell.dayKey, timeZone);
  const labelDate = bounds ? formatLongDate(bounds.start) : cell.dayKey;
  const weekday = bounds ? WEEKDAYS[weekdayIndex(bounds.start, timeZone)] ?? "" : "";
  const ring = today ? "ring-2 ring-accent" : "";

  if (count === 0) {
    return (
      <span
        className={`mx-auto flex size-10 items-center justify-center rounded-full text-base text-subtle ${ring}`}
        aria-label={today ? `${weekday} ${labelDate}, today` : undefined}
      >
        {cell.day}
      </span>
    );
  }

  const workoutLabel = count === 1 ? "1 workout" : `${count} workouts`;
  return (
    <Link
      href={`/history/day/${cell.dayKey}`}
      aria-label={`Open ${workoutLabel} on ${weekday} ${labelDate}`}
      className={`mx-auto flex size-10 items-center justify-center rounded-full bg-inverse text-base font-medium text-inverse-ink ${ring}`}
    >
      {cell.day}
    </Link>
  );
}
