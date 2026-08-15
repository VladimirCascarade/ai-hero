#!/usr/bin/env node
/**
 * Sync shared config into each day app:
 *   shared/.env.shared → {app}/.env
 *   shared/model.ts    → {app}/src/model.ts  (AI apps only)
 *   shared/env.js      → {app}/src/env.js    (AI apps only)
 *
 * Usage (from 00-apps/):
 *   pnpm sync-env
 *   node shared/sync-env.mjs --dry-run
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SHARED_DIR = dirname(fileURLToPath(import.meta.url));
const APPS_ROOT = join(SHARED_DIR, "..");

const APPS = [
  "01-day-1-app",
  "02-day-3-app",
  "03-day-4-app",
  "04-day-6-app",
  "05-day-8-app",
  "06-final-app",
  "07-migrated-to-v5",
];

const AI_APPS = APPS.filter((app) => app !== "01-day-1-app");

const SHARED_ENV = join(SHARED_DIR, ".env.shared");
const SHARED_MODEL = join(SHARED_DIR, "model.ts");
const SHARED_ENV_JS = join(SHARED_DIR, "env.js");

const dryRun = process.argv.includes("--dry-run");

if (!existsSync(SHARED_ENV)) {
  console.error(`Missing ${SHARED_ENV}`);
  console.error(
    `Copy shared/env.shared.example → shared/.env.shared, fill in secrets, then re-run.`,
  );
  process.exit(1);
}

const envContent = readFileSync(SHARED_ENV, "utf8");

if (!envContent.trim()) {
  console.error("shared/.env.shared is empty.");
  process.exit(1);
}

if (!existsSync(SHARED_MODEL)) {
  console.error(`Missing ${SHARED_MODEL}`);
  process.exit(1);
}

if (!existsSync(SHARED_ENV_JS)) {
  console.error(`Missing ${SHARED_ENV_JS}`);
  process.exit(1);
}

const modelContent = readFileSync(SHARED_MODEL, "utf8");
const envJsContent = readFileSync(SHARED_ENV_JS, "utf8");

console.log(dryRun ? "Dry run — would write:\n" : "Syncing shared config to apps:\n");

for (const app of APPS) {
  const envTarget = join(APPS_ROOT, app, ".env");
  if (dryRun) {
    console.log(`  ${app}/.env`);
  } else {
    writeFileSync(envTarget, envContent, "utf8");
    console.log(`  ✓ ${app}/.env`);
  }
}

for (const app of AI_APPS) {
  const modelTarget = join(APPS_ROOT, app, "src", "model.ts");
  const envJsTarget = join(APPS_ROOT, app, "src", "env.js");
  if (dryRun) {
    console.log(`  ${app}/src/model.ts`);
    console.log(`  ${app}/src/env.js`);
    continue;
  }
  writeFileSync(modelTarget, modelContent, "utf8");
  writeFileSync(envJsTarget, envJsContent, "utf8");
  console.log(`  ✓ ${app}/src/model.ts`);
  console.log(`  ✓ ${app}/src/env.js`);
}

if (!dryRun) {
  const model = envContent
    .match(/^OPENROUTER_MODEL=(.+)$/m)?.[1]
    ?.replace(/^["']|["']$/g, "");
  console.log(`\nDone. Model: ${model ?? "(not set)"}`);
  console.log("Restart any running pnpm dev processes to pick up changes.");
}
