# Workout

A mobile-friendly workout log. Sign in with Google, record sets, reps, and weight for any exercise, and open the history later.

Voice comes first. Tap the mic and say a set, for example “bench press, three sets of ten at 135” or “push-ups 20”. The app shows the exercise, sets, reps, and weight so you can edit them. Nothing is written until you confirm, and the first confirmed set starts the workout. During a workout you can also type a set in the bar at the bottom (“squat 3x5 225”), tap `+` for the manual form, or tap `+` on an exercise to log its last set again. Each add shows an Undo.

Push-ups and bench press show up as examples when you have not saved them yet. They are not a fixed exercise list. Type any name to add it. Exercise icons come from words in the name (barbell, dumbbell, kettlebell, bodyweight, cable or machine), with a neutral icon when nothing matches.

Settings sit behind the avatar in the top right: dark mode, installing the app, and signing out. The theme is saved in a `theme` cookie on that device, so the server renders the right one on the first paint.

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
| `GEMINI_API_KEY` | A Gemini API key from Google AI Studio. Server-only: `.env.local` locally, and the Vercel project environment when you deploy. Do not put it on the Convex deployment, and do not prefix it with `NEXT_PUBLIC_`. Voice logging shows a clear message and the manual form still works when it is missing. |
| `GEMINI_MODEL` | Optional. Overrides the Flash model id in `lib/voice/model.ts` (`gemini-3.8-flash`). Same Next.js server environment as `GEMINI_API_KEY`. |

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

## Voice logging

The mic records a short clip in the browser (up to 20 seconds) and sends it to `POST /api/voice`. That route checks the Convex Auth session, then calls Gemini Flash (`gemini-3.8-flash` unless `GEMINI_MODEL` is set) with structured output. The key is read on the server from `GEMINI_API_KEY`.

A typed set goes to the same route as `{ "text": "..." }` (up to 300 characters) and gets the same preview. The audio and text paths share the response schema and the confirm step.

Mobile Safari records `audio/mp4`, which the server sends to Gemini as `audio/m4a`. Mobile Chrome records `audio/webm`. The microphone needs a secure page, so use localhost or HTTPS. If permission is denied, recording is unavailable, or the key is missing, the message says so and you can still type the set.

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
2. Set `NEXT_PUBLIC_CONVEX_URL` in the Vercel project environment to the Convex deployment you want that site to use. Set `GEMINI_API_KEY` there too, as a server variable, if you want voice logging. Do not mark it as exposed to the browser.
3. On that Convex deployment, set `SITE_URL` to the Vercel origin and add that origin plus `https://<deployment>.convex.site/api/auth/callback/google` on the Google OAuth client. Production should use `npx convex deploy` only when you intend to update the production Convex deployment.
4. Use a separate Google OAuth client, or extra redirect URIs, for production. Dev and production Convex deployments do not share environment variables.
