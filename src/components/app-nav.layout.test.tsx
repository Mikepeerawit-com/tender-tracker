import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import "@/app/globals.css";

import en from "@/messages/en.json";
import zhHans from "@/messages/zh-Hans.json";

import { AppHeader } from "./app-header";
import { BottomNav } from "./app-nav";
import { controlRows, drawn, expectNoSidewaysScroll, phone } from "@/test/layout";

/**
 * **The two destinations, in the two bars that draw them** (ADR-0021, #96).
 *
 * Three things are measured here that no other suite can see.
 *
 * **The bottom bar is one row on a phone.** It is the whole reason the set is capped at
 * two: a bar that wraps at 390px spends two of the phone's rows on navigation, which is
 * what #56 cost the header and what `controlRows` was written to catch. This is the
 * assertion that makes a third destination fail rather than merely be regretted — and it
 * only can because the bar is `flex-wrap`. A bar that cannot wrap holds one row whatever
 * it is given and overflows instead, which would leave this measuring a property of the
 * CSS rather than a fact about the screen (ADR-0016).
 *
 * **The right bar is drawn at the right width.** Below `md` the destinations are at the
 * thumb and the app bar is unchanged; above it they are on the app bar and the bottom bar
 * is gone, because a phone control stranded at the foot of a monitor is worse than no
 * control. Both halves are asserted, and the desktop half is why this file resizes the
 * viewport — a suite that only ever ran at 390px could not tell a working `md:` rule from
 * a missing one.
 *
 * **There is room left for an Active Org switcher.** ADR-0021 requires the bar to survive
 * one arriving for the minority holding more than one Membership, without it becoming a
 * third destination for everybody else. That is a claim about width, and a claim about
 * width is worth nothing until something fails when it stops being true (ADR-0016) — so
 * the free space is measured rather than asserted in a comment. Nothing is built for the
 * switcher; this only keeps the room it will need.
 *
 * Both locales, for the reason #56 gives: a Han glyph is about twice the width of a Latin
 * letter, so a shorter Chinese string is not automatically a narrower control.
 */
vi.mock("@/app/actions/auth", () => ({ signOutAction: async () => ({}) }));

const locales = [
  ["en", en],
  ["zh-Hans", zhHans],
] as const;

/** A whole shell: the app bar a page draws, and the bottom bar the `(app)` layout draws. */
function renderShell(locale: string, messages: typeof en) {
  render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
      <AppHeader />
      <BottomNav />
    </NextIntlClientProvider>,
  );
}

/**
 * The two renderings, told apart by where they sit rather than by a class.
 *
 * The top one is inside the `header` and the bottom one is not, which is the structural
 * fact — a selector on a Tailwind class would pass on a bar that had stopped being drawn.
 * `aria-label` narrows to the destinations, which is what both bars are for.
 */
function bars(messages: typeof en) {
  const all = [
    ...document.querySelectorAll<HTMLElement>(
      `nav[aria-label="${messages.nav.destinations}"]`,
    ),
  ];

  return {
    top: all.find((nav) => nav.closest("header") !== null),
    bottom: all.find((nav) => nav.closest("header") === null),
  };
}

describe(`the bottom bar at ${phone.width}×${phone.height}`, () => {
  it.each(locales)("lays its destinations out on one row: in %s", (locale, messages) => {
    renderShell(locale, messages);

    const bottom = bars(messages).bottom!;

    expect(controlRows(bottom)).toBe(1);
    expectNoSidewaysScroll();
  });

  it.each(locales)(
    "leaves a control's worth of room beside them: in %s",
    (locale, messages) => {
      renderShell(locale, messages);

      const bottom = bars(messages).bottom!;
      const links = [...bottom.querySelectorAll("a")];
      const spanned =
        links.at(-1)!.getBoundingClientRect().right -
        links[0].getBoundingClientRect().left;
      // The room *inside* the bar, not the bar's own width: its `px-2` is not space
      // anything can be put in, and counting it would let padding pay for a third of the
      // threshold below.
      const style = getComputedStyle(bottom);
      const inside =
        bottom.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);

      // 44px is `buildspec_2`'s tap floor and therefore the narrowest an Active Org
      // switcher could ever be, and the `gap-2` is the space it would sit behind. Two
      // destinations stretched to half the width each would leave nothing, which is the
      // shape this refuses.
      expect(inside - spanned).toBeGreaterThanOrEqual(44 + 8);
    },
  );

  it.each(locales)(
    "holds exactly two destinations, each a word and an icon: in %s",
    (locale, messages) => {
      renderShell(locale, messages);

      // Both bars, not whichever one is drawn. The rule is about the navigation rather
      // than about one viewport's rendering of it, and a `TopNav` that had lost its
      // glyphs would be invisible to a suite that only ever looked at the bar in front
      // of it.
      for (const bar of [bars(messages).top!, bars(messages).bottom!]) {
        const links = [...bar.querySelectorAll("a")];

        expect(links).toHaveLength(2);

        for (const link of links) {
          // Never an icon instead of a word, in either script — the extension of
          // ADR-0019's rule that colour never carries the only copy of a meaning.
          expect(link.textContent?.trim()).not.toBe("");
          expect(link.querySelector("svg")).not.toBeNull();
        }
      }
    },
  );
});

/**
 * The app bar at the width the destinations arrive at, in the shape that is already
 * tightest.
 *
 * `md` is 768px, and it is where this change costs the most: one pixel wider than the
 * bottom bar's last viewport, the bar that {@link AppHeader} promises is *"one row, at
 * every width"* gains two more controls that will not shrink — on the shape carrying a
 * back control, a reference and a client name too. The rest of the suite measures the
 * phone, where `TopNav` is not drawn at all and so proves nothing about this. The record
 * strings are the unbroken ones a client really supplies, as in `app-header.layout.test.tsx`,
 * because those are the ones that push.
 */
describe("the app bar at 768px, where the destinations join it", () => {
  afterEach(async () => {
    await page.viewport(phone.width, phone.height);
  });

  it.each(locales)("keeps its controls on one row: in %s", async (locale, messages) => {
    await page.viewport(768, 800);

    render(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
        <AppHeader
          location={{
            kind: "record",
            backHref: "/tenders/8f14e45f",
            reference: "TR20260142MOPHDMSCENTRALPROCUREMENT0098",
            detail:
              "ChulalongkornMemorialHospitalProcurementDepartment · NitrileExaminationGlovesPowderFreeSizeMediumNonSterile",
          }}
        />
      </NextIntlClientProvider>,
    );

    const header = document.querySelector("header")!;

    // The destinations really are on the bar here, so a `md:` rule that had moved would
    // fail this rather than quietly make the assertion below easy.
    expect(drawn(bars(messages).top)).toBe(true);
    expect(controlRows(header)).toBe(1);
    expectNoSidewaysScroll();
  });
});

describe("which of the two bars is drawn", () => {
  // The layout project's viewport is the phone, and every other suite in it depends on
  // that. Whatever this describe does to the window is undone before the next file runs.
  afterEach(async () => {
    await page.viewport(phone.width, phone.height);
  });

  it.each(locales)(
    `puts the destinations at the thumb and not on the bar, at ${phone.width}px: in %s`,
    async (locale, messages) => {
      await page.viewport(phone.width, phone.height);
      renderShell(locale, messages);

      expect(drawn(bars(messages).bottom)).toBe(true);
      expect(drawn(bars(messages).top)).toBe(false);
    },
  );

  it.each(locales)(
    "puts them on the bar and takes the bottom bar away, at 1280px: in %s",
    async (locale, messages) => {
      await page.viewport(1280, 800);
      renderShell(locale, messages);

      expect(drawn(bars(messages).top)).toBe(true);
      expect(drawn(bars(messages).bottom)).toBe(false);
    },
  );
});
