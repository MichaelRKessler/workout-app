export function SetupRequired() {
  const code = "rounded bg-fill px-1 py-0.5 font-mono text-[0.9em] text-foreground";
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-5 px-5 py-12">
      <p className="text-xs font-medium tracking-[0.06em] text-subtle uppercase">Spotter</p>
      <h1 className="text-3xl leading-tight font-semibold tracking-[-0.025em]">
        Add the Convex URL to run this app.
      </h1>
      <p className="text-base leading-7 text-muted">
        Copy <code className={code}>.env.example</code> to{" "}
        <code className={code}>.env.local</code>, run{" "}
        <code className={code}>npx convex dev</code>, and set{" "}
        <code className={code}>NEXT_PUBLIC_CONVEX_URL</code> to the deployment URL it
        prints. Google sign-in also needs <code className={code}>AUTH_GOOGLE_ID</code>,{" "}
        <code className={code}>AUTH_GOOGLE_SECRET</code>, <code className={code}>SITE_URL</code>,{" "}
        <code className={code}>JWT_PRIVATE_KEY</code>, and <code className={code}>JWKS</code> on
        the Convex deployment. The README lists where each one goes.
      </p>
    </main>
  );
}
