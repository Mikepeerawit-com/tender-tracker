import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { migrationsOnDisk } from "@/lib/schema/migrations-on-disk.mts";

import { GET } from "./route";

/**
 * The app not knowing its own public URL (#59).
 *
 * Sixth of the six faults, and the only one that needs nothing taken away from Postgres:
 * it is an environment variable, so it is produced by setting one. That is why it is here
 * rather than in `route.exclusive.test.ts` — the exclusive seam exists for faults that are
 * *database-wide*, and paying its serialised, run-alone cost for a fault that is not one
 * would be borrowing a guarantee this file does not need (see `vitest.config.mts`). The
 * one case here that does withhold a migration stays over there, with the machinery.
 *
 * It is the cheapest of the six to wave through as a detail, and the one where everything
 * else about the deployment is fine: the app serves, the schema is level, the tables read.
 * What is broken is the reminders, which are the product — they go out telling people to
 * go into the system and give them no way in.
 */

const newest = migrationsOnDisk().at(-1);

/** A usable `APP_ORIGIN`, so a healthy answer here really is the healthy answer. */
const configuredOrigin = "https://tenders.example.test";

type HealthBody = {
  status: string;
  database?: string;
  schema: { expected: string; applied: string | null; behind: number | null };
  appOrigin?: { configured: boolean; origin?: string; error?: string };
  email?: { configured: boolean; from?: string; error?: string };
  checkedAt: string;
};

async function health(): Promise<{ status: number; body: HealthBody }> {
  const response = await GET(new Request("http://localhost/api/health"));

  return { status: response.status, body: (await response.json()) as HealthBody };
}

describe("GET /api/health, on a deployment that does not know its own URL", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOW_RUN_INSTANT_HEADER", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses to call itself ok", async () => {
    vi.stubEnv("APP_ORIGIN", "");

    const { status, body } = await health();

    expect(status).toBe(503);
    expect(body.status).not.toBe("ok");
  });

  it("gives the fault its own name rather than folding it into misconfigured", async () => {
    // ADR-0016's stated consequence: the faults stay distinguishable because each has a
    // different fix. "No Supabase credentials" and "nobody set the app's public URL" are
    // not the same errand, and a reader sent to the Supabase dashboard for this one would
    // find nothing wrong there.
    vi.stubEnv("APP_ORIGIN", "");

    const { body } = await health();

    expect(body.status).toBe("no-app-origin");
    expect(body.appOrigin).toMatchObject({ configured: false });
    expect(body.appOrigin?.error).toContain("APP_ORIGIN");
  });

  it("still reports a healthy database, because the database is healthy", async () => {
    // The fault is one level up from Postgres. A response that went quiet about the
    // schema here would lose the fact that everything else is level.
    vi.stubEnv("APP_ORIGIN", "");

    const { body } = await health();

    expect(body.database).toBe("reachable");
    expect(body.schema).toEqual({ expected: newest, applied: newest, behind: 0 });
  });

  it("reports an origin it refused as unconfigured, not as configured", async () => {
    // The variable is set, so a check reading "is it defined" would pass. It is `http`,
    // which is not a deployment WeCom's webview should be sending anybody to.
    vi.stubEnv("APP_ORIGIN", "http://tenders.example.test");

    const { status, body } = await health();

    expect(status).toBe(503);
    expect(body.status).toBe("no-app-origin");
    expect(body.appOrigin?.error).toContain("http://tenders.example.test");
  });

  it("names the origin on the healthy answer, so a wrong one is visible too", async () => {
    // The likelier misconfiguration is not an unset variable but one pointing at the
    // wrong deployment, which `configured: true` alone would report as fine.
    vi.stubEnv("APP_ORIGIN", `${configuredOrigin}/`);

    const { status, body } = await health();

    expect(status).toBe(200);
    expect(body.appOrigin).toEqual({ configured: true, origin: configuredOrigin });
  });
});

/**
 * The deployment that cannot mail anybody (ADR-0034) — the seventh fault, and the
 * email twin of the six above it. The transport itself throws at the first real send,
 * so this probe is where the gate catches a deployment whose morning run would be the
 * first to find out.
 */
describe("GET /api/health, on a deployment that cannot send email", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOW_RUN_INSTANT_HEADER", "true");
    vi.stubEnv("APP_ORIGIN", configuredOrigin);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses to call itself ok without the key, and names the fault", async () => {
    vi.stubEnv("RESEND_API_KEY", "");

    const { status, body } = await health();

    expect(status).toBe(503);
    expect(body.status).toBe("no-email-config");
    expect(body.email).toMatchObject({ configured: false });
    expect(body.email?.error).toContain("RESEND_API_KEY");
  });

  it("treats a missing sender the same way — mail from nowhere is filed as spam", async () => {
    vi.stubEnv("EMAIL_FROM", "");

    const { body } = await health();

    expect(body.status).toBe("no-email-config");
    expect(body.email?.error).toContain("EMAIL_FROM");
  });

  it("refuses a sender the transport would refuse — configured has to mean sendable", async () => {
    // Set, non-blank, and refused by the provider on every send. `configured: true`
    // here would let a deployment-wide typo be paid for in settled rows nobody was
    // ever mailed, because a 4xx closes deliveries (ADR-0034). One policy: this is the
    // same check sendEmails throws on.
    vi.stubEnv("EMAIL_FROM", "Tender Tracker reminders@example.test");

    const { status, body } = await health();

    expect(status).toBe(503);
    expect(body.status).toBe("no-email-config");
    expect(body.email?.error).toContain("EMAIL_FROM");
  });

  it("lets the origin fault outrank it, so the reader meets one errand at a time", async () => {
    vi.stubEnv("APP_ORIGIN", "");
    vi.stubEnv("RESEND_API_KEY", "");

    const { body } = await health();

    expect(body.status).toBe("no-app-origin");
    // Not lost, though: the email fault is still named for whoever reads the body.
    expect(body.email).toMatchObject({ configured: false });
  });

  it("names the sender on the healthy answer, so a wrong one is visible too", async () => {
    const { status, body } = await health();

    expect(status).toBe(200);
    expect(body.email).toEqual({
      configured: true,
      from: "Tender Tracker <test@example.test>",
    });
  });
});
