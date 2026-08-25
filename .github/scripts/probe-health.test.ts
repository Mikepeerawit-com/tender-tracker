import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

/**
 * The probe script, run for real against a real HTTP server.
 *
 * ADR-0016 is the reason this file exists rather than a reading of the script. Both
 * faults it records survived review by being read; what caught them was breaking the
 * thing they watched. So every branch below is *produced* — a server that answers `302`,
 * a body with `behind: 3`, a port with nothing behind it — and the assertion is on what
 * the script then says, because the message is the whole product. A probe that exits 1
 * with the wrong sentence sends somebody to the wrong fix, which is the failure mode the
 * five-way diagnosis exists to prevent.
 */

const script = fileURLToPath(new URL("./probe-health.sh", import.meta.url));

let running: Server | undefined;

afterEach(async () => {
  const server = running;
  running = undefined;

  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

type Answer = { status: number; body?: unknown; headers?: Record<string, string> };

/** A server that answers every request the same way, and remembers what it was asked. */
async function serving(
  answer: Answer | ((request: IncomingMessage) => Answer),
): Promise<{ origin: string; requests: IncomingMessage[] }> {
  const requests: IncomingMessage[] = [];

  const server = createServer((request, response) => {
    requests.push(request);

    const { status, body, headers } = typeof answer === "function" ? answer(request) : answer;

    response.writeHead(status, { "content-type": "application/json", ...headers });
    response.end(body === undefined ? "" : JSON.stringify(body));
  });

  running = server;

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

type Run = { code: number; output: string; summary: string };

function probe(env: Record<string, string>): Promise<Run> {
  // Written where GitHub writes it, so the summary the commit status is built from is
  // exercised rather than assumed.
  const githubOutput = join(mkdtempSync(join(tmpdir(), "probe-")), "output");

  return new Promise((resolve) => {
    execFile(
      script,
      [],
      {
        env: {
          PATH: process.env.PATH ?? "",
          GITHUB_OUTPUT: githubOutput,
          // The retry loop exists for a connection that never opened. At the shipped
          // five seconds a test of it costs ten, so the delay is a knob — the branch
          // has to be reachable in a test to be a branch anyone has seen work.
          PROBE_RETRY_DELAY: "0",
          ...env,
        },
      },
      (error, stdout, stderr) => {
        const summary = readFileSync(githubOutput, "utf8");

        resolve({
          code: error && typeof error.code === "number" ? error.code : 0,
          output: `${stdout}${stderr}`,
          summary,
        });
      },
    );
  });
}

const healthy = {
  status: "ok",
  database: "reachable",
  schema: { expected: "20260825010000", applied: "20260825010000", behind: 0 },
  tables: { probed: "tenders", readable: true },
};

describe("a production probe", () => {
  it("passes, and names the migration production is level at", async () => {
    const { origin } = await serving({ status: 200, body: healthy });

    const run = await probe({ PROBE_TARGET: "production", HEALTH_ORIGIN: origin });

    expect(run.code).toBe(0);
    expect(run.output).toContain("::notice::");
    expect(run.output).toContain("20260825010000");
  });

  it("reads a redirect as protection switched on, never as a preview to step around", async () => {
    const { origin } = await serving({ status: 302, headers: { location: "/sso" } });

    const run = await probe({ PROBE_TARGET: "production", HEALTH_ORIGIN: origin });

    expect(run.code).toBe(1);
    expect(run.output).toMatch(/Deployment Protection/i);
  });

  it("does not ask for a bypass secret it should not need", async () => {
    const { origin, requests } = await serving({ status: 200, body: healthy });

    const run = await probe({ PROBE_TARGET: "production", HEALTH_ORIGIN: origin });

    expect(run.code).toBe(0);
    expect(requests[0].headers["x-vercel-protection-bypass"]).toBeUndefined();
  });
});

describe("a preview probe", () => {
  const secret = "bypass-secret-value";

  /** Deployment Protection, as far as this test is concerned: the header or the door. */
  const protectedPreview = (answer: Answer) => (request: IncomingMessage) =>
    request.headers["x-vercel-protection-bypass"] === secret
      ? answer
      : ({ status: 302, headers: { location: "/sso" } } satisfies Answer);

  it("passes when the branch's migrations are on the shared database", async () => {
    const { origin } = await serving(protectedPreview({ status: 200, body: healthy }));

    const run = await probe({
      PROBE_TARGET: "preview",
      HEALTH_ORIGIN: origin,
      VERCEL_AUTOMATION_BYPASS_SECRET: secret,
    });

    expect(run.code).toBe(0);
  });

  it("fails, naming the versions, when the branch expects more than the database holds", async () => {
    const { origin } = await serving(
      protectedPreview({
        status: 503,
        body: {
          status: "degraded",
          database: "reachable",
          schema: { expected: "20260901120000", applied: "20260825010000", behind: 2 },
          tables: { probed: "tenders", readable: true },
        },
      }),
    );

    const run = await probe({
      PROBE_TARGET: "preview",
      HEALTH_ORIGIN: origin,
      VERCEL_AUTOMATION_BYPASS_SECRET: secret,
    });

    expect(run.code).toBe(1);
    expect(run.output).toContain("20260901120000");
    expect(run.output).toContain("20260825010000");
    expect(run.output).toContain("supabase db push");
  });

  it("fails naming the secret when the secret is not set at all, without asking", async () => {
    const { origin, requests } = await serving({ status: 200, body: healthy });

    const run = await probe({ PROBE_TARGET: "preview", HEALTH_ORIGIN: origin });

    expect(run.code).toBe(1);
    expect(run.output).toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(requests).toHaveLength(0);
  });

  it("fails on a redirect rather than concluding it cannot check and is therefore fine", async () => {
    const { origin } = await serving(protectedPreview({ status: 200, body: healthy }));

    const run = await probe({
      PROBE_TARGET: "preview",
      HEALTH_ORIGIN: origin,
      VERCEL_AUTOMATION_BYPASS_SECRET: "the-rotated-one",
    });

    expect(run.code).toBe(1);
    expect(run.output).toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(run.output).not.toMatch(/skip/i);
  });

  // Every code that means "you are looking at the door, not the app". Vercel answers 302
  // today; the rest are here so a change of platform behaviour lands on the sentence that
  // names the secret rather than on the catch-all, which would still go red but would
  // send the reader somewhere useless.
  it.each([301, 302, 303, 307, 308, 401, 403])(
    "fails on %i with the diagnosis, not the catch-all",
    async (status) => {
      const { origin } = await serving({ status, headers: { location: "/sso" } });

      const run = await probe({
        PROBE_TARGET: "preview",
        HEALTH_ORIGIN: origin,
        VERCEL_AUTOMATION_BYPASS_SECRET: secret,
      });

      expect(run.code).toBe(1);
      expect(run.output).toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
      expect(run.output).not.toMatch(/with status/);
    },
  );
});

describe("the five faults stay apart", () => {
  it.each([
    [
      "misconfigured",
      { status: 500, body: { status: "misconfigured", error: "no url", schema: { expected: "1", applied: null, behind: null } } },
      /Supabase credentials/i,
    ],
    [
      "a database that does not answer",
      { status: 503, body: { status: "degraded", database: "unreachable", schema: { expected: "1", applied: null, behind: null } } },
      /paused/i,
    ],
    [
      "a database no migration ever reached",
      { status: 503, body: { status: "degraded", database: "reachable", schema: { expected: "20260825010000", applied: null, behind: null } } },
      /no migration ever reached/i,
    ],
    [
      "a schema behind the build",
      { status: 503, body: { status: "degraded", database: "reachable", schema: { expected: "20260825010000", applied: "20260101000000", behind: 3 }, tables: { probed: "tenders", readable: true } } },
      /missing 3 of its migration/i,
    ],
    [
      "a schema it cannot read",
      { status: 503, body: { status: "degraded", database: "reachable", schema: { expected: "1", applied: "1", behind: 0 }, tables: { probed: "tenders", readable: false, error: "42501" } } },
      /grants/i,
    ],
  ])("names %s", async (_name, answer, expected) => {
    const { origin } = await serving(answer as Answer);

    const run = await probe({ PROBE_TARGET: "production", HEALTH_ORIGIN: origin });

    expect(run.code).toBe(1);
    expect(run.output).toMatch(expected);
  });

  it("reports `readable: false` as unreadable rather than as unknown", async () => {
    // `jq`'s `//` treats `false` as absent, so the one value this branch exists to catch
    // is the one a `// "unknown"` would swallow. Produced, because it has bitten here.
    const { origin } = await serving({
      status: 503,
      body: {
        status: "degraded",
        database: "reachable",
        schema: { expected: "1", applied: "1", behind: 0 },
        tables: { probed: "tenders", readable: false, error: "42501" },
      },
    });

    const run = await probe({ PROBE_TARGET: "production", HEALTH_ORIGIN: origin });

    expect(run.output).not.toMatch(/unknown/i);
  });

  it("asks once, so a considered 503 is not retried into three concatenated bodies", async () => {
    const { origin, requests } = await serving({
      status: 503,
      body: { status: "degraded", database: "unreachable", schema: { expected: "1", applied: null, behind: null } },
    });

    await probe({ PROBE_TARGET: "production", HEALTH_ORIGIN: origin });

    expect(requests).toHaveLength(1);
  });
});

describe("when nothing answers at all", () => {
  it("says so, and says it is a different fault from a database being down", async () => {
    // Bound and closed: a port nothing is listening on, so the connection is refused
    // rather than hanging.
    const { origin } = await serving({ status: 200, body: healthy });
    await new Promise<void>((resolve) => running!.close(() => resolve()));
    running = undefined;

    const run = await probe({ PROBE_TARGET: "production", HEALTH_ORIGIN: origin });

    expect(run.code).toBe(1);
    expect(run.output).toMatch(/did not answer at all/i);
    expect(run.output).toMatch(/unreachable/i);
  });
});

describe("the summary the commit status carries", () => {
  it("is written for a pass and for a failure, and fits a status description", async () => {
    const { origin } = await serving({ status: 200, body: healthy });
    const pass = await probe({ PROBE_TARGET: "production", HEALTH_ORIGIN: origin });

    expect(pass.summary).toMatch(/^summary=.+/m);

    const { origin: other } = await serving({
      status: 503,
      body: {
        status: "degraded",
        database: "reachable",
        schema: { expected: "20260901120000", applied: "20260825010000", behind: 2 },
        tables: { probed: "tenders", readable: true },
      },
    });
    const fail = await probe({ PROBE_TARGET: "preview", HEALTH_ORIGIN: other, VERCEL_AUTOMATION_BYPASS_SECRET: "s" });

    const line = /^summary=(.+)$/m.exec(fail.summary)?.[1] ?? "";

    expect(line).toContain("2");
    // GitHub truncates a commit status description at 140 characters, and a truncated
    // diagnosis loses the version numbers at the end of the sentence.
    expect(line.length).toBeLessThanOrEqual(140);
  });
});
