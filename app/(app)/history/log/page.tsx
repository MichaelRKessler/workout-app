import { LogPastWorkout } from "@/components/LogPastWorkout";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Log a past workout",
};

export default function LogPastPage() {
  return <LogPastWorkout />;
}
