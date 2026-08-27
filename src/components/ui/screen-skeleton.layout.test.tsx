import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import "@/app/globals.css";

import { ScreenSkeleton } from "@/components/ui/screen-skeleton";
import en from "@/messages/en.json";
import { phone } from "@/test/layout";

/**
 * That the fallback is *there* — which no overflow assertion can tell you.
 *
 * `screens.layout.test.tsx` already measures this screen alongside the others and holds
 * it to ADR-0009's bar. What it cannot catch is the failure this component is one edit
 * away from: a skeleton that collapses to nothing still scrolls sideways nowhere, passes
 * every assertion in that file, and ships as a blank page.
 *
 * The way it collapses is specific and easy to reintroduce. `ScreenHeader`'s text column
 * is a shrink-to-fit flex item, so its width comes from its content — and a bar sized in
 * percent asks for a share of a width that is being derived from it. A single such bar is
 * harmless, because its fixed-width siblings settle the column first; swap the last of
 * those for a fraction too and the circle resolves to zero, the column draws nothing, and
 * the fallback becomes the very blank screen it exists to replace. That is a one-line
 * tidy-up away at any time, and it looks like the tidier version.
 *
 * So this asserts the boring thing on purpose — every bar has a box — and it runs in the
 * `layout` project rather than the jsdom one because jsdom reports every width as `0` and
 * would agree with the bug.
 */

describe(`the loading fallback at ${phone.width}×${phone.height}`, () => {
  function renderSkeleton() {
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Bangkok">
        <ScreenSkeleton />
      </NextIntlClientProvider>,
    );
  }

  it("draws every bar with a box somebody can see", () => {
    renderSkeleton();

    const bars = [...document.querySelectorAll<HTMLElement>(".animate-pulse")];

    // Four in the header, two in each of the three blocks below it.
    expect(bars).toHaveLength(10);

    const collapsed = bars.filter(
      (bar) => bar.offsetWidth === 0 || bar.offsetHeight === 0,
    );

    expect(collapsed).toEqual([]);
  });

  it("says it is loading, for a reader who cannot see the bars", () => {
    renderSkeleton();

    // The bars are `aria-hidden`, so this sentence is the whole of what a screen reader
    // gets — and the fallback would otherwise announce as an empty page.
    expect(screen.getByRole("status")).toHaveTextContent(en.app.loading);
  });
});
