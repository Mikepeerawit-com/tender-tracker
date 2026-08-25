/**
 * The migrations the running build expects its database to hold.
 *
 * Baked in at build time by `next.config.ts` from `supabase/migrations/` — see
 * `migrations-on-disk.ts` for why it arrives this way rather than being read from disk
 * here. `process.env.EXPECTED_SCHEMA_MIGRATIONS` is written out literally so Next can
 * substitute it; a destructure or a dynamic lookup would leave it `undefined` in a
 * production bundle, which is why `requiredEnv` is not used.
 */
export class MissingExpectedMigrationsError extends Error {
  constructor() {
    super(
      "EXPECTED_SCHEMA_MIGRATIONS was not baked into this build. " +
        "`next.config.ts` sets it from supabase/migrations/ — a build that lost it cannot " +
        "tell whether its database is up to date.",
    );
    this.name = "MissingExpectedMigrationsError";
  }
}

/**
 * @throws {MissingExpectedMigrationsError} when the constant is absent or empty.
 * Deliberately loud: a probe that quietly expects nothing agrees with every database it
 * ever meets, which is the defect #40 is about.
 *
 * In a real build the `undefined` half of that guard is unreachable — Next replaces the
 * lookup below with a string literal, so there is nothing left to be undefined. It fires
 * on the empty string, which is what a build whose migrations directory could not be read
 * would bake in, and it fires anywhere the route runs outside a Next build, which is
 * where its tests run.
 */
export function expectedMigrations(): string[] {
  const baked = process.env.EXPECTED_SCHEMA_MIGRATIONS;

  if (baked === undefined || baked === "") {
    throw new MissingExpectedMigrationsError();
  }

  return baked.split(",");
}
