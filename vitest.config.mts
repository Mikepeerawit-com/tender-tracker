import { execFileSync } from "node:child_process";

import { defineConfig } from "vitest/config";

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
 * is interactive: a Margin recomputing as digits are typed into the row, and (in #30) the
 * working sheet's scrollWidth at 390×844. These cannot resolve packages under
 * `react-server` — that condition is what makes React's client hooks unavailable — which
 * is the reason the two are separate projects rather than one with two environments.
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
          env: localSupabaseEnv(),
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "browser",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./vitest.setup.dom.ts"],
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
