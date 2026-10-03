# Workout

A mobile-friendly workout log. Sign in with Google, record sets, reps, and weight for any exercise, and open the history later.

Push-ups and bench press show up as examples when you have not saved them yet. They are not a fixed exercise list. Type any name to add it.

Voice logging is not part of this version.

## Run it locally

You need Node.js 20+ and a Convex account. The Next.js app and the Convex backend run as two processes.

```bash
npm install
cp .env.example .env.local
npx convex dev
```

`npx convex dev` logs you into Convex, creates a dev deployment, and writes these into `.env.local`:

- `CONVEX_DEPLOYMENT`
- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CONVEX_SITE_URL` (the HTTP actions origin; the Google redirect URI is this origin plus `/api/auth/callback/google`)

Leave `.env.local` gitignored. The app code reads `NEXT_PUBLIC_CONVEX_URL`. You do not set `NEXT_PUBLIC_CONVEX_SITE_URL` by hand.

In a second terminal:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Google sign-in stays broken until the Convex deployment variables and the Google OAuth client below are set. The rest of the app builds without them.

## Required keys and dashboard settings

Nothing secret belongs in the repo. `.env.example` only has placeholders.

### Next.js: `.env.local`, and later the Vercel project environment

| Name | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | Printed by `npx convex dev`. Same value as the deployment URL in the Convex dashboard under Settings → URL & Deploy Key. It looks like `https://<name>.convex.cloud`. |
| `CONVEX_DEPLOYMENT` | Written by `npx convex dev`. The CLI uses it to find the dev deployment. Do not invent this yourself. |

### Convex deployment environment

Set these in the Convex dashboard for the dev deployment (Settings → Environment Variables), or with `npx convex env set`. They are not Next.js variables.

| Name | Value |
| --- | --- |
| `SITE_URL` | `http://localhost:3000` while you run locally. When you deploy the site later, set this on the **production** Convex deployment to that site's origin, for example `https://your-app.vercel.app`. |
| `JWT_PRIVATE_KEY` | Generated locally. Run `node scripts/generateAuthKeys.mjs` and paste the printed value. Do not commit the output. |
| `JWKS` | Printed by the same script. Paste the whole JSON object. |
| `AUTH_GOOGLE_ID` | OAuth client ID from Google Cloud. |
| `AUTH_GOOGLE_SECRET` | OAuth client secret from Google Cloud. |

`CONVEX_SITE_URL` is provided by Convex. Do not set it yourself.

Example:

```bash
npx convex env set SITE_URL http://localhost:3000
npx convex env set AUTH_GOOGLE_ID your-client-id
npx convex env set AUTH_GOOGLE_SECRET your-client-secret
npx convex env set JWT_PRIVATE_KEY -- "paste the generated PKCS8 key"
npx convex env set JWKS -- 'paste the generated JSON'
```

Quote the JWT and JWKS values so the shell does not split them.

### Google Cloud OAuth client

In Google Cloud Console, configure the OAuth consent screen, then create an OAuth client ID of type **Web application**.

- Authorized JavaScript origin: `http://localhost:3000`
- Authorized redirect URI: `https://<your-deployment>.convex.site/api/auth/callback/google`

The host is the Convex HTTP Actions URL (the deployment URL with `.convex.site` instead of `.convex.cloud`). Find it in the Convex dashboard under Settings → URL & Deploy Key. If the consent screen is in testing, add the Google account you sign in with as a test user.

Sign-in uses [Convex Auth](https://labs.convex.dev/auth) with the Google provider, so there is no second auth vendor.

## Check the project

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

`npm run build` succeeds before the Convex URL and Google keys exist. Signing in and saving workouts needs those values and `npx convex dev` running (or a deployed Convex backend).

## Deploy later

This repo is ready to put on Vercel, and it is not linked to a Vercel project.

1. Create a Vercel project from this repo when you want to deploy. Do not commit a `.vercel` directory.
2. Set `NEXT_PUBLIC_CONVEX_URL` in the Vercel project environment to the Convex deployment you want that site to use.
3. On that Convex deployment, set `SITE_URL` to the Vercel origin and add that origin plus `https://<deployment>.convex.site/api/auth/callback/google` on the Google OAuth client. Production should use `npx convex deploy` only when you intend to update the production Convex deployment.
4. Use a separate Google OAuth client, or extra redirect URIs, for production. Dev and production Convex deployments do not share environment variables.
