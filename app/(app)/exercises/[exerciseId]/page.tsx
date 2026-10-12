import { ExerciseHistory } from "@/components/ExerciseHistory";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Exercise",
};

export default async function ExercisePage({
  params,
  searchParams,
}: {
  params: Promise<{ exerciseId: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { exerciseId } = await params;
  const query = await searchParams;
  const from = Array.isArray(query.from) ? query.from[0] : query.from;
  return <ExerciseHistory exerciseId={exerciseId} from={from ?? null} />;
}
