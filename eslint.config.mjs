import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // ADR-0010: the run instant is read once at the request boundary and passed
    // down. `src/lib/run-instant.ts` is the boundary; everywhere else, reading the
    // wall clock makes a date rule untestable, so it is an error rather than a habit.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/run-instant.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            "Take the run instant as an argument — resolve it once with runInstantFrom(request) at the boundary. See docs/adr/0010-injected-run-instant.md.",
        },
        {
          selector:
            "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            "Take the run instant as an argument — resolve it once with runInstantFrom(request) at the boundary. See docs/adr/0010-injected-run-instant.md.",
        },
      ],
    },
  },
  {
    // Sessions live in server-set cookies, never localStorage: WebKit's Tracking
    // Prevention deletes script-writable storage after 7 idle days, which turns the
    // promised 30-day session into 7 for an app whose whole usage pattern is sparse.
    // `supabase-js`'s own createClient stores sessions in localStorage by default,
    // so user-facing code goes through the `@supabase/ssr` cookie clients instead.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/supabase/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@supabase/supabase-js",
              importNames: ["createClient"],
              message:
                "Build clients in src/lib/supabase/ — user-facing sessions must be cookie-backed via @supabase/ssr, never localStorage.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Not ours to lint.
    "prototypes/**",
    // Written by `supabase start` — bundled vendor code, and which files land here
    // varies by CLI version, so it must be ignored by directory rather than by file.
    "supabase/.temp/**",
  ]),
]);

export default eslintConfig;
