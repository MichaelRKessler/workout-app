"use client";

import { api } from "@/convex/_generated/api";
import type { WeightUnit } from "@/convex/lib/units";
import { browserStore, loadWeightUnit, saveWeightUnit } from "@/lib/offline/storage";
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
