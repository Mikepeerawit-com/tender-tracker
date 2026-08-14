import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { requiredEnv } from "@/lib/env";

/**
 * Four rules this ticket depends on that no runtime test can catch, because breaking
 * them produces code that works perfectly in every environment a developer will try.
 *
 * They are checked by reading the source, which is blunt, and which is the point: each
 * one fails weeks later, on someone else's phone, in a way nobody will connect back to
 * the change that caused it.
 */

const sourceRoot = join(process.cwd(), "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return sourceFiles(path);
    if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) return [path];

    return [];
  });
}

/**
 * Comments are stripped before matching. Each of these rules is worth a paragraph
 * explaining itself at the place it applies, and a guard that fires on its own
 * documentation trains people to delete the documentation.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

function offendingFiles(pattern: RegExp): string[] {
  return sourceFiles(sourceRoot).filter((path) => pattern.test(code(path)));
}

const userFacingText = [
  join(sourceRoot, "messages", "en.json"),
  join(sourceRoot, "messages", "zh-Hans.json"),
  join(process.cwd(), "supabase", "templates", "invite.html"),
];

describe("session storage", () => {
  it("never puts anything in localStorage", () => {
    // WebKit's Tracking Prevention clears script-writable storage after 7 idle days.
    // A session there turns the promised 30 days into 7 for an app whose usage is
    // sparse by design — and it fails on a phone, weeks later, for one person at a
    // time.
    expect(offendingFiles(/\blocalStorage\b/)).toEqual([]);
  });

  it("builds no browser-side Supabase client", () => {
    // `createBrowserClient` persists the session from script, which lands in the same
    // capped storage. Every client in this codebase is server-side and cookie-backed.
    expect(offendingFiles(/createBrowserClient/)).toEqual([]);
  });
});

describe("the email surface", () => {
  it("has no password-reset flow", () => {
    // Under ten users the Org Admin resets from the Supabase dashboard. Keeping the app
    // at exactly one template is what makes an SMTP misconfiguration obvious instead of
    // a class of bug.
    expect(offendingFiles(/resetPasswordForEmail/)).toEqual([]);
  });
});

describe("the WeCom webview", () => {
  it.each(userFacingText)("never tells the reader to use a browser (%s)", (path) => {
    // Every reminder link lands in the WeCom in-app webview and there is no way out of
    // it into Safari, so the advice is unfollowable as well as wrong.
    const text = readFileSync(path, "utf8");

    expect(text.toLowerCase()).not.toContain("open in your browser");
    expect(text).not.toContain("浏览器");
  });
});

describe("the way in", () => {
  it("refuses self-signup at the platform, not just in the UI", async () => {
    // Accounts exist only by invitation. An unlinked signup form is not the gate — the
    // endpoint is public whether or not anything renders a link to it.
    const response = await fetch(
      `${requiredEnv("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/signup`,
      {
        method: "POST",
        headers: {
          apikey: requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: `self-signup-${crypto.randomUUID()}@example.test`,
          password: "correct-horse-battery-staple",
        }),
      },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error_code: "signup_disabled",
    });
  });
});
