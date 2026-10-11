import { ExerciseHistory } from "@/components/ExerciseHistory";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Exercise",
};

export default async function ExercisePage({
  params,
}: {
  params: Promise<{ exerciseId: string }>;
}) {
  const { exerciseId } = await params;
  return <ExerciseHistory exerciseId={exerciseId} />;
}
