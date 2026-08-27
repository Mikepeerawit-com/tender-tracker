import { execFileSync } from "node:child_process";

import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { migrationsOnDiskEnv } from "./src/lib/schema/migrations-on-disk.mts";
import { phone } from "./src/test/phone.mts";

/**
 * Two seams, told apart by the file extension.
 *
 * **`.test.ts` — server.** Route handlers and server actions, run against the real local
 * Postgres that `supabase start` brings up. Nothing is mocked but the two outbound
 * boundaries (the WeCom robot webhook, the Frankfurter rate fetch), because the riskiest
 * logic here — derived progress, the overdue conditions, the reminder engine's state
 * across runs — does not survive being lifted out of the database.
 *
 * **`.test.tsx` — the browser half.** The few behaviours that exist only once a component
 * is interactive, such as a Margin recomputing as digits are typed into the row. These
 * cannot resolve packages under `react-server` — that condition is what makes React's
 * client hooks unavailable — which is the reason they are a separate project rather than
 * one with two environments.
 *
 * **`.exclusive.test.ts` — the server seam again, alone.** A handful of tests can only
 * prove their point by breaking the shared database — revoking a grant every screen
 * needs, withholding a migration. Those faults are database-wide, not worker-wide, so
 * they would fail whichever unrelated suite happened to be mid-query. This project runs
 * them in a later `groupOrder`, when nothing else is running.
 *
 * **`.github/scripts/*.test.ts` — the checks themselves.** The deployment probes are
 * shell, and ADR-0016 says a check is only reviewed by breaking what it watches. These
 * run the real script against a real local HTTP server answering each health body shape.
 * They need no database and no browser, so they are their own project rather than a
 * reason to start Supabase.
 *
 * **`.layout.test.tsx` — a real browser.** ADR-0009's failure bar, that nothing scrolls
 * sideways at 390×844. jsdom has no layout engine and reports every `scrollWidth` as `0`,
 * so those assertions pass there on a page overflowing by a mile. They run in headless
 * Chromium instead, which is why this project alone needs
 * `npx playwright install chromium`.
 *
 * It began as one file guarding the comparison sheet, and #56 was what that cost: the app
 * shell's header overflowed on every screen for an org admin and no test could see it.
 * Every screen is an `async` Server Component, most of them behind a layout that gates on
 * `currentUser`, so none is reachable from a browser test. What is reachable is the sync
 * presentational seam those pages hand their data to — `AppHeader`, `TenderRow` and
 * `ScreenHeader`, the last of which is the header of all three screens hand-check 1 of
 * #48 walked. That is why they are components rather than markup inlined in a page: a
 * screen with no such seam cannot be measured here at all.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { tsconfigPaths: true },
        // The seam is server code, so resolve packages the way the server runtime does.
        // Without `react-server`, `import "server-only"` throws on import and any handler
        // that reaches a server-only module is untestable.
        ssr: {
          resolve: {
            conditions: ["react-server", "node", "module", "import", "default"],
          },
        },
        test: {
          name: "server",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.exclusive.test.ts"],
          env: localSupabaseEnv(),
        },
      },
      {
        resolve: { tsconfigPaths: true },
        ssr: {
          resolve: {
            conditions: ["react-server", "node", "module", "import", "default"],
          },
        },
        test: {
          name: "exclusive",
          environment: "node",
          include: ["src/**/*.exclusive.test.ts"],
          env: localSupabaseEnv(),
          // Everything else has finished by the time this group starts, which is the
          // only thing that makes revoking a live grant safe.
          sequence: { groupOrder: 1 },
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "scripts",
          environment: "node",
          include: [".github/scripts/**/*.test.ts"],
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "browser",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          exclude: ["src/**/*.layout.test.tsx"],
          setupFiles: ["./vitest.setup.dom.ts"],
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "layout",
          include: ["src/**/*.layout.test.tsx"],
          setupFiles: ["./vitest.setup.layout.ts"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            // The width ADR-0009's failure bar is stated at, held in one place so the
            // suites that name it in their titles cannot drift from what is measured.
            instances: [{ browser: "chromium", viewport: phone }],
          },
        },
      },
    ],
  },
});

function localSupabaseEnv(): Record<string, string> {
  const status = readSupabaseStatus();

  return {
    NEXT_PUBLIC_SUPABASE_URL: required(status, "API_URL"),
    // The key the browser gets. RLS tests need it: they must ask the database the way
    // an untrusted client does, which the service-role key cannot do.
    NEXT_PUBLIC_SUPABASE_ANON_KEY: required(status, "ANON_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: required(status, "SERVICE_ROLE_KEY"),
    // A superuser connection straight past PostgREST. Nothing in the app has one, and
    // nothing in the app should: it exists so a test can take a privilege away and put
    // it back, which is the only way to prove /api/health notices.
    SUPABASE_DB_URL: required(status, "DB_URL"),
    // What `next.config.ts` bakes into a real build, supplied here the same way for the
    // same reason: /api/health compares it against what the database says it holds, and
    // a suite that left it unset would be testing a probe that expects nothing.
    EXPECTED_SCHEMA_MIGRATIONS: migrationsOnDiskEnv(),
  };
}

function readSupabaseStatus(): Map<string, string> {
  let output: string;

  try {
    output = execFileSync("supabase", ["status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error(
      "The tests run against a real local Postgres, which is not up. Run `supabase start`.",
    );
  }

  return new Map(
    output
      .split("\n")
      .map((line) => /^([A-Z0-9_]+)="(.*)"$/.exec(line))
      .filter((match) => match !== null)
      .map((match) => [match[1], match[2]]),
  );
}

function required(status: Map<string, string>, key: string): string {
  const value = status.get(key);

  if (value === undefined || value === "") {
    throw new Error(`\`supabase status\` reported no ${key}. Is the stack healthy?`);
  }

  return value;
}
