import { DayDetail } from "@/components/DayDetail";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Workout",
};

export default async function HistoryDayPage({
  params,
}: {
  params: Promise<{ day: string }>;
}) {
  const { day } = await params;
  return <DayDetail dayKey={day} />;
}
