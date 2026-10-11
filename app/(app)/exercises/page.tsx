import { ExerciseLibrary } from "@/components/ExerciseLibrary";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Exercises",
};

export default function ExercisesPage() {
  return <ExerciseLibrary />;
}
