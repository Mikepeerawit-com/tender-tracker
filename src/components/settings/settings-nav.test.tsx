import { existsSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import zhHans from "@/messages/zh-Hans.json";

import { SettingsNav } from "./settings-nav";

/**
 * **What Settings offers, and to whom** (#132).
 *
 * Two claims live here and nowhere else. The layout suite walks both shapes of this column
 * and measures them, which is a claim about width; what it cannot say is *which rows were
 * in it*, because a column with the Organisation group wrongly drawn measures exactly as
 * well as one without it.
 *
 * **The Organisation group is not drawn for a member who is not an Org Admin** — not
 * drawn-and-disabled and not drawn-and-empty, which are the two ways this gets implemented
 * by accident. Asserted as the whole list of rows rather than as an absence, so that a
 * heading left behind over no rows fails too.
 *
 * **Preferences is what a member does get**, which is the half of the ticket that is not
 * about hiding anything: opening the menu used to find one item, Sign out, and the point
 * of moving the language switcher off the bar was to put something in Settings for
 * somebody who administers nothing. The column stays drawn for them — a member's Settings
 * is an Org Admin's with a group withheld, not a different kind of screen.
 *
 * Both locales, because the rows are translated and a row that fell back to its key would
 * still be a row.
 */

/** Where each row goes and what it is called, in the order the column draws them. */
function rowsIn(container: HTMLElement): [string, string][] {
  return [...container.querySelectorAll("a")].map((link) => [
    link.getAttribute("href") ?? "",
    (link.textContent ?? "").trim(),
  ]);
}

function drawFor(locale: string, messages: typeof en, isOrgAdmin: boolean): HTMLElement {
  const { container } = render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
      <SettingsNav isOrgAdmin={isOrgAdmin} />
    </NextIntlClientProvider>,
  );

  return container;
}

describe.each([
  ["en", en],
  ["zh-Hans", zhHans],
])("the Settings column, in %s", (locale, messages) => {
  it("offers an Org Admin their own preferences and the organisation's three screens", () => {
    expect(rowsIn(drawFor(locale, messages, true))).toEqual([
      ["/settings", messages.preferences.title],
      ["/settings/people", messages.nav.people],
      ["/settings/group-robot", messages.nav.groupRobot],
      ["/settings/currency-conversion", messages.nav.currencyConversion],
    ]);
  });

  it("names the organisation's group, so an Org Admin can see which changes affect everybody", () => {
    drawFor(locale, messages, true);

    expect(
      screen.getByRole("heading", { name: messages.nav.organisation }),
    ).toBeDefined();
  });

  it("offers a member who is not an Org Admin their preferences, and nothing else", () => {
    expect(rowsIn(drawFor(locale, messages, false))).toEqual([
      ["/settings", messages.preferences.title],
    ]);
  });

  it("does not draw the organisation's group for them at all", () => {
    drawFor(locale, messages, false);

    // Not drawn-and-disabled and not drawn-and-empty: a greyed row advertises a screen
    // nobody can open, and a heading over nothing says this reader's copy is broken. The
    // heading is asserted as well as the rows, because a heading left behind over an
    // empty group is the second of those two and passes a rows-only check.
    expect(
      screen.queryByRole("heading", { name: messages.nav.organisation }),
    ).toBeNull();
  });

  it("still draws the column for them, rather than a different kind of screen", () => {
    drawFor(locale, messages, false);

    expect(
      screen.getByRole("navigation", { name: messages.nav.settingsGroups }),
    ).toBeDefined();
  });
});

/**
 * The one thing a test of a rendered list cannot otherwise catch: a route that moved.
 *
 * These paths are the whole of how anybody reaches Settings, and a `<Link>` to a route
 * that has gone is a 404 out of a column that looks perfectly correct.
 *
 * **The path comes from the column rather than from a table beside it.** A table would
 * have to be kept in step with `groups`, and a check that a table agrees with a table is
 * one that cannot fail — the shape ADR-0022 deleted from `screens.layout.test.tsx` for
 * exactly that reason. What is asserted here is a fact about the disk, against an `href`
 * a reader would really follow.
 *
 * A filesystem fact in the browser seam, which is not where they usually go — but the
 * `href`s being checked exist only once this component is rendered.
 */
describe("every row of the column", () => {
  it("leads to a route that exists on disk", () => {
    const paths = rowsIn(drawFor("en", en, true)).map(([href]) => href);

    // The empty case would pass the loop below silently, and a column that stopped
    // drawing anything is precisely one of the faults this is here for.
    expect(paths).toHaveLength(4);

    // Reported as pairs so a failure names the path that has no page, rather than
    // saying `false` was not `true`.
    expect(
      paths.map((path) => [
        path,
        existsSync(join(process.cwd(), `src/app/(app)${path}/page.tsx`)),
      ]),
    ).toEqual(paths.map((path) => [path, true]));
  });
});
