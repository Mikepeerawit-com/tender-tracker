import { describe, expect, it, vi } from "vitest";

/**
 * **The one line the whole no-flash claim rests on** (#133).
 *
 * `theme.layout.test.tsx` proves what each class paints, in a real browser, against an
 * operating system that disagrees. What it cannot prove is that anything ever *writes*
 * one: it renders its own ground, so the root layout could stop putting the class on
 * `<html>` altogether and every assertion in it would still hold — and the app would
 * paint light for every reader who had pinned dark, with nothing failing anywhere.
 *
 * This is that half. It is not a rendering test: a Server Component is a function, and
 * what this asks is what the element it returns says. Which is also why it can live in
 * jsdom at all — nothing here is drawn.
 *
 * `next/font/google` and `next-intl/server` are stubbed because both are compile-time
 * arrangements of Next's rather than behaviour of this file's, and neither exists outside
 * a build. **`themeClassName` is deliberately not stubbed**: the class the layout writes
 * has to be the one `globals.css` is written against, and a test that stubbed it would
 * agree with itself while the two drifted.
 */

vi.mock("next/font/google", () => ({
  Fira_Sans: () => ({ variable: "fira-sans-variable" }),
  Fira_Code: () => ({ variable: "fira-code-variable" }),
}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "zh-Hans",
  getTranslations: async () => (key: string) => key,
}));

const chosen = vi.hoisted(() => ({ theme: "system" as "system" | "light" | "dark" }));

vi.mock("@/lib/theme/cookie", () => ({ getThemeChoice: async () => chosen.theme }));

const { default: RootLayout } = await import("./layout");

async function documentClasses(theme: "system" | "light" | "dark"): Promise<string[]> {
  chosen.theme = theme;

  const html = await RootLayout({ children: null, params: Promise.resolve({}) });

  return String(html.props.className).split(" ");
}

describe("the class the server writes on the document", () => {
  it("asks the device when the reader has left it to them", async () => {
    await expect(documentClasses("system")).resolves.toContain("theme-system");
  });

  it("pins dark when the reader pinned dark", async () => {
    const classes = await documentClasses("dark");

    expect(classes).toContain("dark");
    expect(classes).not.toContain("theme-system");
  });

  it("says nothing at all when the reader pinned light", async () => {
    // Light is the ground `:root` already states, so pinning it is the absence of an
    // override rather than an override of its own — and the empty string it maps to must
    // not survive into the markup as a stray class or a double space.
    const classes = await documentClasses("light");

    expect(classes).not.toContain("theme-system");
    expect(classes).not.toContain("dark");
    expect(classes).not.toContain("");
  });

  it("keeps the font variables it was already carrying", async () => {
    // The theme class is prepended to a list that was there first. Asserted so that the
    // way it is written on cannot quietly replace them.
    await expect(documentClasses("dark")).resolves.toEqual(
      expect.arrayContaining(["fira-sans-variable", "fira-code-variable", "antialiased"]),
    );
  });
});
