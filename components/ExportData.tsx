"use client";

import { useOfflineLog } from "@/components/OfflineSync";
import { useLengthUnit, useWeightUnit } from "@/components/WeightUnit";
import { api } from "@/convex/_generated/api";
import { readableError } from "@/lib/errors";
import { calendarDayKey } from "@/lib/historyDays";
import { bodyCsv, collectPages, routinesCsv, setsCsv, zipStored } from "@/lib/spreadsheet";
import { useConvex } from "convex/react";
import { useState } from "react";

/** Downloads every set, body entry, and routine as three CSVs in one zip. */
export function ExportData() {
  const convex = useConvex();
  const weightUnit = useWeightUnit();
  const lengthUnit = useLengthUnit();
  const { offline } = useOfflineLog();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function download() {
    if (offline || busy) {
      return;
    }
    setBusy(true);
    setFailed(false);
    setMessage(null);
    try {
      const sets = await collectPages((cursor) =>
        convex.query(api.exportData.sets, {
          paginationOpts: { numItems: 100, cursor },
        }),
      );
      const body = await collectPages((cursor) =>
        convex.query(api.exportData.body, {
          paginationOpts: { numItems: 100, cursor },
        }),
      );
      const routines = await convex.query(api.exportData.routines, {});
      const zip = zipStored([
        { name: "sets.csv", text: setsCsv(sets.rows, weightUnit) },
        { name: "body.csv", text: bodyCsv(body.rows, weightUnit, lengthUnit) },
        { name: "routines.csv", text: routinesCsv(routines, weightUnit) },
      ]);
      const copy = new Uint8Array(zip.byteLength);
      copy.set(zip);
      const blob = new Blob([copy.buffer], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `workout-${calendarDayKey(Date.now())}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage(
        sets.complete && body.complete
          ? "Downloaded sets, body entries, and routines."
          : "Downloaded, but a very long history was cut off after 400 pages.",
      );
    } catch (caught) {
      setFailed(true);
      setMessage(readableError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void download()}
        disabled={offline || busy}
        className="flex min-h-14 w-full items-center justify-between px-4 text-left text-base font-medium hover:bg-fill-2 disabled:opacity-60"
      >
        {busy ? "Preparing spreadsheet…" : "Download spreadsheet"}
        <span className="text-sm font-normal text-muted">CSV</span>
      </button>
      {offline ? (
        <p className="border-t border-line px-4 py-3 text-sm leading-normal text-muted">
          Export needs a connection.
        </p>
      ) : null}
      {message ? (
        <p
          role={failed ? "alert" : "status"}
          className={`border-t border-line px-4 py-3 text-sm leading-normal ${failed ? "text-danger" : "text-muted"}`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
