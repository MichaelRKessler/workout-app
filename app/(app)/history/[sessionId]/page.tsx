import { SessionDetail } from "@/components/SessionDetail";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Workout",
};

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <SessionDetail sessionId={sessionId} />;
}
