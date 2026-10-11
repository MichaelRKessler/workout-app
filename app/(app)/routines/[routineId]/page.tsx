import { RoutineEditor } from "@/components/routines/RoutineEditor";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Edit routine",
};

export default async function EditRoutinePage({
  params,
}: {
  params: Promise<{ routineId: string }>;
}) {
  const { routineId } = await params;
  return <RoutineEditor routineId={routineId} />;
}
