"use client";

import { api } from "@/convex/_generated/api";
import type { WeightUnit } from "@/convex/lib/units";
import { useQuery } from "convex/react";
import { createContext, ReactNode, useContext } from "react";

const WeightUnitContext = createContext<WeightUnit>("lb");

export function WeightUnitProvider({ children }: { children: ReactNode }) {
  const preferences = useQuery(api.users.preferences);
  return (
    <WeightUnitContext.Provider value={preferences?.weightUnit ?? "lb"}>
      {children}
    </WeightUnitContext.Provider>
  );
}

export function useWeightUnit(): WeightUnit {
  return useContext(WeightUnitContext);
}
