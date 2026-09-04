import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cdp } from "vitest/browser";

import "@/app/globals.css";

import { themeClassName, type ThemeChoice } from "@/lib/theme/config";

/**
 * **What each of the three answers actually paints, against a device that disagrees.**
 *
 * This is the half of #133 that no other seam can reach. The row of buttons is checked in
 * jsdom, the row it sits in is measured at 390px, and both would pass on an app where
 * every choice painted the same screen — because the choice is not a prop or a class a
 * component owns. It is a class the *server* writes onto `<html>` and a media query in
 * `globals.css` reads, so the only place the claim is true or false is in a browser with
 * an operating system preference to disagree with.
 *
 * The operating system is emulated over CDP, which is the one way a test can hold an
 * opinion the page cannot see coming. Chromium only, and this project is Chromium.
 *
 * **The class comes from `themeClassName`**, the same function the root layout calls, so
 * this is a claim about the app rather than about three strings retyped here. If light
 * ever stops being *the absence of a class*, or `theme-system` is renamed, this fails
 * rather than quietly testing a selector nothing writes.
 *
 * **It asserts a property, not a value** — the ground under System is *the same ground as*
 * the pinned answer the device asked for, and not the other one. No oklch triple appears
 * below: the palette was repainted whole in #130 and is free to move again, and a test
 * that named a colour would be a second place to repaint.
 */

/** What the operating system says it wants, for the length of one test. */
async function deviceAsks(scheme: "light" | "dark"): Promise<void> {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: scheme }],
  });
}

/**
 * The ground the root layout draws, painted the way `@layer base` paints the real `body`.
 *
 * A class alone would define every token and paint them onto nothing, which is a screen
 * whose background never changed and a test that could not fail — the note `Ground` in
 * `@/test/screens` carries, for the same reason.
 */
function groundFor(choice: ThemeChoice): HTMLElement {
  const { container } = render(
    <div className={`${themeClassName(choice)} bg-background text-foreground`}>
      the working sheet
    </div>,
  );

  return container.firstElementChild as HTMLElement;
}

/** The colour a reader really sees behind the words, flattened by the browser. */
function ground(choice: ThemeChoice): string {
  return getComputedStyle(groundFor(choice)).backgroundColor;
}

afterEach(async () => {
  // Emulation is per page, not per test, so a test that left it set would decide the
  // answer for whichever file ran next in this browser.
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
  document.body.innerHTML = "";
});

describe("a device asking for dark", () => {
  beforeEach(() => deviceAsks("dark"));

  it("is followed by System, which is what a reader who has never chosen holds", () => {
    expect(ground("system")).toBe(ground("dark"));
  });

  it("is overruled by a reader who pinned light", () => {
    // The whole point of pinning: a phone put into dark mode at night for other reasons
    // does not get to decide this app, in either direction.
    expect(ground("light")).not.toBe(ground("dark"));
  });
});

describe("a device asking for light", () => {
  beforeEach(() => deviceAsks("light"));

  it("is followed by System", () => {
    expect(ground("system")).toBe(ground("light"));
  });

  it("is overruled by a reader who pinned dark", () => {
    expect(ground("dark")).not.toBe(ground("light"));
  });
});

describe("the two grounds", () => {
  it("are different colours at all, whatever the device says", async () => {
    // Without this the two suites above are four assertions that would all hold on an app
    // with one palette and a dead media query (ADR-0016).
    await deviceAsks("light");

    expect(ground("light")).not.toBe(ground("dark"));
  });

  it("hand the browser its own scheme, so a native control is not the one light thing", () => {
    // `color-scheme` is what paints the canvas before this stylesheet arrives and what
    // colours a scrollbar, a date picker and a `select`. It is the half of the switch that
    // is not tokens, and nothing else in the suite would notice it going missing.
    expect(getComputedStyle(groundFor("dark")).colorScheme).toBe("dark");
    expect(getComputedStyle(groundFor("system")).colorScheme).toBe("light dark");
  });
});
