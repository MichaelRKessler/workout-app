import { SignInScreen } from "@/components/SignInScreen";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function SignInPage() {
  return (
    <Suspense fallback={<main className="px-5 pt-8 text-base text-muted">Loading…</main>}>
      <SignInScreen />
    </Suspense>
  );
}
