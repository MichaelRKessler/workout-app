import { RoutineManager } from "@/components/routines/RoutineManager";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Routines",
};

export default function RoutinesPage() {
  return <RoutineManager />;
}
