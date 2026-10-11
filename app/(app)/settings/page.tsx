import { SettingsScreen } from "@/components/SettingsScreen";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return <SettingsScreen />;
}
