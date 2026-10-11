import { RoutineEditor } from "@/components/routines/RoutineEditor";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New routine",
};

export default function NewRoutinePage() {
  return <RoutineEditor />;
}
