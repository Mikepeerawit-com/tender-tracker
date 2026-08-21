/**
 * The run instant: the moment a request is being handled at.
 *
 * The convention this file exists to enforce is that the wall clock is read **once,
 * at the request boundary**, and then passed down as an argument. Business logic —
 * progress, the three overdue conditions, the reminder engine — never calls
 * `new Date()` itself, because a clock read inside a handler makes every
 * date-boundary rule untestable. See docs/adr/0010-injected-run-instant.md.
 */

/** Header carrying the instant a request should be handled as if it ran at. */
export const runInstantHeader = "x-run-instant";

export class InvalidRunInstantError extends Error {
  constructor(value: string) {
    super(`Not a valid run instant: ${value}`);
    this.name = "InvalidRunInstantError";
  }
}

/**
 * Resolve the instant this request runs at.
 *
 * Tests and local runs may pin it with the {@link runInstantHeader}, but only when
 * `ALLOW_RUN_INSTANT_HEADER` is set and the build is not a production one. A header
 * is untrusted input: in production it is disregarded, never honoured and never an
 * error, so that traffic cannot steer the app's idea of time.
 *
 * @throws {InvalidRunInstantError} when an honoured header cannot be parsed — a
 * pinned instant that silently falls back to "now" would make a test pass by lying.
 */
export function runInstantFrom(request: Request): Date {
  return runInstantFromHeaders(request.headers);
}

/**
 * The same resolution, for a boundary that has headers but no `Request`.
 *
 * A Server Component is one: it is a request boundary — the top of a render, where the
 * clock is read once and passed down — but Next hands it `headers()` rather than the
 * request itself. Without this, a page that needs to know what day it is in the org's
 * timezone has no way to obey ADR-0010 except by breaking it.
 */
export function runInstantFromHeaders(headers: Headers): Date {
  const pinned = headers.get(runInstantHeader);

  if (pinned === null || !runInstantHeaderAllowed()) {
    return new Date();
  }

  const instant = new Date(pinned);

  if (Number.isNaN(instant.getTime())) {
    throw new InvalidRunInstantError(pinned);
  }

  return instant;
}

function runInstantHeaderAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_RUN_INSTANT_HEADER === "true"
  );
}
