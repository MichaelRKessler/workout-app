"use client";

import { api } from "@/convex/_generated/api";
import { defaultLengthUnit, type LengthUnit } from "@/convex/lib/bodyMeasures";
import type { WeightUnit } from "@/convex/lib/units";
import {
  browserStore,
  loadLengthUnit,
  loadWeightUnit,
  saveLengthUnit,
  saveWeightUnit,
} from "@/lib/offline/storage";
import { useQuery } from "convex/react";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";

const WeightUnitContext = createContext<WeightUnit>("lb");

export function WeightUnitProvider({ children }: { children: ReactNode }) {
  const preferences = useQuery(api.users.preferences);
  const [cached, setCached] = useState<WeightUnit | null>(null);

  useEffect(() => {
    setCached(loadWeightUnit(browserStore()));
  }, []);

  useEffect(() => {
    if (!preferences?.weightUnit) {
      return;
    }
    saveWeightUnit(browserStore(), preferences.weightUnit);
    setCached(preferences.weightUnit);
  }, [preferences?.weightUnit]);

  return (
    <WeightUnitContext.Provider value={preferences?.weightUnit ?? cached ?? "lb"}>
      {children}
    </WeightUnitContext.Provider>
  );
}

export function useWeightUnit(): WeightUnit {
  return useContext(WeightUnitContext);
}

/** Last known inches or centimeters, then the weight-unit default while that loads. */
export function useLengthUnit(): LengthUnit {
  const preferences = useQuery(api.users.preferences);
  const weightUnit = useWeightUnit();
  const [cached, setCached] = useState<LengthUnit | null>(null);

  useEffect(() => {
    setCached(loadLengthUnit(browserStore()));
  }, []);

  useEffect(() => {
    if (!preferences?.lengthUnit) {
      return;
    }
    saveLengthUnit(browserStore(), preferences.lengthUnit);
    setCached(preferences.lengthUnit);
  }, [preferences?.lengthUnit]);

  return preferences?.lengthUnit ?? cached ?? defaultLengthUnit(weightUnit);
}
