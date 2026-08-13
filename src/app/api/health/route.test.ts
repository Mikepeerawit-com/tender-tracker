import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runInstantHeader } from "@/lib/run-instant";

import { GET } from "./route";

const fixedInstant = "2026-03-01T09:00:00.000Z";

function healthRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/health", { headers });
}

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOW_RUN_INSTANT_HEADER", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports the database as reachable when Postgres answers", async () => {
    const response = await GET(healthRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      database: "reachable",
    });
  });

  it("reports the run instant it was handed rather than the wall clock", async () => {
    const response = await GET(healthRequest({ [runInstantHeader]: fixedInstant }));

    await expect(response.json()).resolves.toMatchObject({ checkedAt: fixedInstant });
  });

  it("ignores an injected run instant unless overrides are enabled", async () => {
    vi.stubEnv("ALLOW_RUN_INSTANT_HEADER", "");

    const response = await GET(healthRequest({ [runInstantHeader]: fixedInstant }));
    const { checkedAt } = (await response.json()) as { checkedAt: string };

    expect(checkedAt).not.toBe(fixedInstant);
    expect(Date.parse(checkedAt)).toBeGreaterThan(Date.parse("2026-08-01T00:00:00.000Z"));
  });

  it("rejects an unparseable run instant instead of guessing one", async () => {
    const response = await GET(healthRequest({ [runInstantHeader]: "the day before" }));

    expect(response.status).toBe(400);
  });

  it("calls a misconfigured deployment misconfigured, not unreachable", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const response = await GET(healthRequest({ [runInstantHeader]: fixedInstant }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ status: "misconfigured" });
  });

  it("degrades rather than throwing when Postgres cannot be reached", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1");

    const response = await GET(healthRequest({ [runInstantHeader]: fixedInstant }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "degraded",
      database: "unreachable",
      checkedAt: fixedInstant,
    });
  });
});
