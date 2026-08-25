import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The migration versions this checkout contains — read from `supabase/migrations/`.
 *
 * **This module runs at build time only.** It is imported by `next.config.ts` and
 * `vitest.config.mts`, which bake the result into `EXPECTED_SCHEMA_MIGRATIONS` for the
 * app to read; nothing under `src/app` may import it, because `supabase/` is not part of
 * a deployed bundle and `node:fs` has nothing to find there.
 *
 * The indirection is the point. #40 asks for the expected version to be *derived* from
 * the migrations directory and never hand-maintained, because a constant somebody has to
 * remember to bump is the same forgettable step the probe exists to catch, moved one
 * level up.
 *
 * Resolved from this file rather than `process.cwd()`: the two configs that call it are
 * loaded by different tools, and only one of them promises a working directory.
 */
export function migrationsOnDisk(): string[] {
  const directory = fileURLToPath(new URL("../../../supabase/migrations", import.meta.url));

  return readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => name.split("_")[0])
    .sort();
}

/** The versions as one string, which is all an environment variable can carry. */
export function migrationsOnDiskEnv(): string {
  return migrationsOnDisk().join(",");
}
