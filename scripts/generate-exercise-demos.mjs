/**
 * Build lib/demos/catalogue.json from free-exercise-db (public domain, Unlicense).
 * The commit is pinned so the image URLs in lib/demos/catalogue.ts keep pointing
 * at the same files. Bump both together.
 *
 * Usage: node scripts/generate-exercise-demos.mjs
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const COMMIT = "f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5";
const SOURCE = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${COMMIT}/dist/exercises.json`;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const response = await fetch(SOURCE);
if (!response.ok) {
  throw new Error(`Download failed: ${response.status}`);
}
const exercises = await response.json();

// Only exercises with both photos, since the demo flips between them. The
// photos sit at <id>/0.jpg and <id>/1.jpg, so the id is all a client needs.
const entries = exercises
  .filter((exercise) => exercise.images.length === 2 && exercise.images[0] === `${exercise.id}/0.jpg`)
  .map((exercise) => ({
    id: exercise.id,
    name: exercise.name.trim(),
    equipment: exercise.equipment ?? null,
    muscles: exercise.primaryMuscles,
    steps: exercise.instructions.map((step) => step.trim()).filter(Boolean),
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

writeFileSync(resolve(root, "lib/demos/catalogue.json"), `${JSON.stringify(entries)}\n`);
console.log(`Wrote ${entries.length} exercises`);
