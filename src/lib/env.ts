/**
 * Read a required environment variable, failing loudly at the point of use.
 *
 * Deliberately read on each call rather than captured at module load: tests pin
 * these per-case, and a value captured at import time cannot be pinned.
 */
export function requiredEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
