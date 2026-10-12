# Workout

A mobile-friendly workout log. Sign in with Google, record sets for any exercise, and open the history later. A set can be reps and weight, a time (a plank), or a distance (a row), with an optional RPE. Weights are stored in pounds and shown in the unit you pick in Settings, pounds or kilograms. The home screen shows this week against last week. Under it, a front and back body shades each muscle group by this week's working sets and lists the groups you have not trained yet. Tapping a muscle opens your exercises for it, and the Exercises list in Settings has the same filter. Each exercise has its own history, with your best set, an estimated one-rep max, and a trend. A finished workout can be corrected or deleted, and a workout you forgot can be logged for the day it happened. Settings also lists your exercises so you can rename one, or merge a duplicate into the name you want to keep.

Voice comes first. Tap the mic and say one or more exercises, for example “bench press, three sets of ten at 135, then rows, three sets of eight at 95” or “plank 60 seconds”. “Superset curls and pushdowns, 3 rounds of 12 at 30 and 50” groups those two exercises. The app shows each exercise as its own block so you can edit the sets, and a superset is labeled before you save. Nothing is written until you confirm, and confirming saves every exercise in one step. The first confirmed set starts the workout. During a workout you can also type a set in the bar at the bottom (“squat 3x5 225”), tap `+` for the manual form, or tap `+` on an exercise to log its last set again. Each add shows an Undo. A workout can carry a short note.

Two or more adjacent exercises can be a superset, in a routine or during a workout. The checklist points at the exercise that is behind in the round. Rest starts after the whole round, using the longest rest in the group. History shows the group as “Curl + Pushdown”.

The installed app’s icon menu has four fixed shortcuts: New workout, Repeat last workout, Routines, and Log body weight. A shortcut cannot be one of your named routines, because the list is part of the app manifest. A specific routine can still be opened with `/start?routine=<id>`. If you are signed out, that link waits on the sign-in page and comes back. If a workout is already open, the shortcut continues it instead of starting a second one.

Settings can download a zip of three spreadsheets: every set, every body entry, and every routine. Weights are listed in pounds, kilograms, and the unit your account is using.

Push-ups and bench press show up as examples when you have not saved them yet. They are not a fixed exercise list. Type any name to add it. Exercise icons come from words in the name (barbell, dumbbell, kettlebell, bodyweight, cable or machine), with a neutral icon when nothing matches.

Settings sit behind the avatar in the top right: weight unit, the exercise list, dark mode, installing the app, and signing out. The weight unit is saved with your account. The theme is saved in a `theme` cookie on that device, so the server renders the right one on the first paint.

## Run it locally

You need Node.js 24 and a Convex account. The Next.js app and the Convex backend run as two processes.

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

### Next.js: `.env.local`, and the Vercel project environment

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
| `SITE_URL` | `http://localhost:3000` while you run locally. On the **production** Convex deployment it is the site's origin, `https://repsandsets.vercel.app`. |
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

## Offline

Gym signal is often too weak for voice or for Convex. A set logged by hand is written to this phone first, with an id generated here, and shown as pending until it syncs. Sending it again uses that same id, so reconnecting cannot create a second copy. Finish, keep going, discard, edits, and a past workout use the same queue. Voice and typed parsing need a connection; the manual form does not. The installed app keeps a network-first copy of its shell so it can open offline, then picks up the live site the next time it loads. History and the weekly summary wait for the network.

## Check the project

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

`npm run build` succeeds before the Convex URL and Google keys exist. Signing in and saving workouts needs those values and `npx convex dev` running (or a deployed Convex backend).

Pull requests and pushes to `main` run these same commands in GitHub Actions. That workflow does not use a Convex URL, a Gemini key, or any other secret.

`tests/statsFuzz.vitest.ts` runs random mixes of logging, edits, deletes, offline batches, merges, cron ticks, and repeated or late rebuild pages, and checks the stats after every step. It uses a few fixed seeds. To search longer, run `STATS_FUZZ_SEEDS=1-200 STATS_FUZZ_STEPS=300 npx vitest run tests/statsFuzz.vitest.ts`. A failure names its seed, step, and the operations before it.

### Checking exercise stats

Each exercise keeps a stats row (its bests, set count, and newest set), and each set keeps the records it set. Writes update them in place or rebuild them in the background. Two internal queries recompute them from the sets and list what disagrees. They only read, and they are not callable from the app.

```bash
npx convex run --prod exerciseStats:auditUser '{"userId":"<user id>","cursor":null}'
npx convex run --prod exerciseStats:auditExercise '{"userId":"<user id>","exerciseId":"<exercise id>"}'
```

The user id is the `_id` of your row in the `users` table: Convex dashboard → the production deployment → Data → `users`. Exercise ids are in the `exercises` table. The dashboard's Functions page can run the same queries.

`auditUser` checks up to ten exercises per call, fewer when their histories are long. Pass its `continueCursor` back as `cursor` until it is `null`. `clean` counts exercises that match their sets, and `flagged` lists the rest with their mismatches:

- `"rebuilding"`: a rebuild is still running. Run it again in a minute; the cron restarts a rebuild that stalls.
- `"2 stats rows"`: left by older code. The next set logged, edited, or deleted for that exercise keeps one row and rebuilds it.
- `"too many sets"` or `"too many marks"`: more than 4,000 sets, or 2,000 record marks, which is more than one query should read. It is not checked.
- Anything else, such as a wrong best or a set's record stamps, is a bug. Open an issue with the output.

### Before merging changes to logging, sync, or stats

The tests run against a simulated backend, so check these on a phone too. Use a dev deployment where you can: previews write to the live data.

- Offline, then reconnect: in airplane mode, log three sets and undo one, then reconnect. Each set shows once, nothing stays pending, and the workout shows two sets.
- Two tabs: log a set in one tab and edit or delete it in the other. Both show the same sets, and the exercise page shows the same best.
- Finish, then log a past workout: finish today's workout, then log one for an earlier day with a heavier set. The exercise page shows the heavier best, and today's lighter set no longer shows as a record.
- Merge in a superset: during a superset, merge one of its exercises into another in Settings. The workout, History, and the kept exercise's best all show the merged sets.
- Delete, then log again: delete the set that holds an exercise's best, then log it again. The record is announced once and the exercise page matches.
- Rest timer on iPhone: log a set and wait out the rest with the app open. It chimes. Switch to another app and back, log again, and it still chimes.

## Deployment

Production is the Vercel project `workout-app` at [repsandsets.vercel.app](https://repsandsets.vercel.app). It is linked to this GitHub repo, so every push to `main` deploys to production, and other branches get preview deployments. Do not commit a `.vercel` directory.

The production build runs `npx convex deploy` first. That pushes the functions in `convex/` to the production Convex deployment (`honorable-tern-770`), then builds the site. Backend and site changes ship together, so there is no separate Convex push. If the Convex step fails, the build fails and the previous version stays live. The build command is set in Vercel under Project Settings → Build and Deployment.

Vercel environment variables:

| Name | Environments | What it is |
| --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | Production, Preview | `https://honorable-tern-770.convex.cloud` |
| `CONVEX_DEPLOY_KEY` | Production | A production deploy key from the Convex dashboard, used by the build. Keep it secret. |
| `GEMINI_API_KEY` | Production | Server-only Gemini key for voice and typed sets. Do not expose it to the browser. |

Preview deployments point at the same Convex deployment, so they read and write the live data. Voice and typed sets do not work in previews, because `GEMINI_API_KEY` is set for production only.

On the production Convex deployment, `SITE_URL` must be the site's origin (`https://repsandsets.vercel.app`), and the Google OAuth client needs `https://honorable-tern-770.convex.site/api/auth/callback/google` as an authorized redirect URI. Dev and production Convex deployments do not share environment variables, so set these on production separately.
