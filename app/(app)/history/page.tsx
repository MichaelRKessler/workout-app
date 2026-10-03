import { HistoryList } from "@/components/HistoryList";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "History",
};

export default function HistoryPage() {
  return <HistoryList />;
}
