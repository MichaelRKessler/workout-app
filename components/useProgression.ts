"use client";

import { useWeightUnit } from "@/components/WeightUnit";
import { api } from "@/convex/_generated/api";
import { effectiveIncrementLb } from "@/convex/lib/progression";
import { loadProgression, saveProgression, browserStore } from "@/lib/offline/storage";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";

export function useProgression() {
  const prefs = useQuery(api.users.preferences);
  const unit = useWeightUnit();
  const [cached, setCached] = useState<{ enabled: boolean; incrementLb: number | null } | null>(
    null,
  );

  useEffect(() => {
    setCached(loadProgression(browserStore()));
  }, []);

  useEffect(() => {
    if (!prefs) {
      return;
    }
    const next = {
      enabled: prefs.suggestNextWeight,
      incrementLb: prefs.progressionIncrementLb,
    };
    saveProgression(browserStore(), next);
    setCached(next);
  }, [prefs]);

  const storedIncrementLb = prefs?.progressionIncrementLb ?? cached?.incrementLb ?? null;
  return {
    enabled: prefs?.suggestNextWeight ?? cached?.enabled ?? true,
    incrementLb: effectiveIncrementLb(storedIncrementLb, unit),
    storedIncrementLb,
  };
}
