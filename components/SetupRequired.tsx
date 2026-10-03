export function SetupRequired() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-5 py-12">
      <p className="text-sm font-semibold tracking-[0.18em] text-accent uppercase">
        Workout
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">
        Add the Convex URL to run this app.
      </h1>
      <p className="text-base leading-7 text-muted">
        Copy <code className="text-foreground">.env.example</code> to{" "}
        <code className="text-foreground">.env.local</code>, run{" "}
        <code className="text-foreground">npx convex dev</code>, and set{" "}
        <code className="text-foreground">NEXT_PUBLIC_CONVEX_URL</code> to the
        deployment URL it prints. Google sign-in also needs{" "}
        <code className="text-foreground">AUTH_GOOGLE_ID</code>,{" "}
        <code className="text-foreground">AUTH_GOOGLE_SECRET</code>,{" "}
        <code className="text-foreground">SITE_URL</code>,{" "}
        <code className="text-foreground">JWT_PRIVATE_KEY</code>, and{" "}
        <code className="text-foreground">JWKS</code> on the Convex deployment.
        The README lists where each one goes.
      </p>
    </main>
  );
}
