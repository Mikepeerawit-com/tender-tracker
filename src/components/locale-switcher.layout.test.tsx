import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import "@/app/globals.css";

import { AppHeader } from "@/components/app-header";
import en from "@/messages/en.json";
import zhHans from "@/messages/zh-Hans.json";
import { controlRows, expectNoSidewaysScroll, phone } from "@/test/layout";

/**
 * The app bar **while a language is being switched**, which is a wider bar than the one
 * every other suite measures.
 *
 * The switch now puts a spinner on the button that was pressed (#57), and a spinner is
 * 14px plus a gap the bar did not previously have to find. #56 is what running out of
 * width on this bar costs, so the widened state gets measured rather than assumed.
 *
 * That is the whole reason this file exists rather than another case in
 * `screens.layout.test.tsx`. Every other measurement in this repo renders a screen and
 * measures it; this one has to *press something first*, because the state at risk does
 * not exist until then — and a control that only fits before it is pressed is one nobody
 * measured. An org admin throughout, whose six admin buttons are the worst case, in both
 * locales, since a Han glyph is about twice the width of a Latin letter.
 *
 * Only what needs a layout engine is here. Which button spins, and what the live region
 * says, are DOM facts and are asserted in `locale-switcher.test.tsx` under jsdom, per the
 * seam split `vitest.config.mts` documents.
 *
 * `switchLocale` is stubbed with a promise that never settles — not a shortcut around
 * timing, but the only way to hold `isPending` open long enough to measure it, and an
 * honest model of what a phone on mobile data sits in for the length of the round trip.
 */

vi.mock("@/app/actions/auth", () => ({ signOutAction: async () => ({}) }));
vi.mock("@/app/actions/locale", () => ({ switchLocale: () => new Promise(() => {}) }));

const locales = [
  ["en", en],
  ["zh-Hans", zhHans],
] as const;

describe(`the app bar mid-switch at ${phone.width}×${phone.height}`, () => {
  it.each(locales)("does not scroll sideways, in %s", async (locale, messages) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
        <AppHeader name="Somchai Prasertkul" isOrgAdmin />
      </NextIntlClientProvider>,
    );

    const { short } = messages.localeSwitcher;
    // The language that is *not* current, which is the only one anybody presses.
    const target = locale === "en" ? short["zh-Hans"] : short.en;

    await userEvent.click(screen.getByRole("button", { name: target }));

    expectNoSidewaysScroll();
    expect(controlRows(document.querySelector("header")!)).toBe(1);

    // Both languages keep a box somebody can see, which is the constraint the extra 14px
    // would be traded against if the bar ran short.
    for (const label of [short.en, short["zh-Hans"]]) {
      expect(screen.getByRole("button", { name: label }).offsetWidth).toBeGreaterThan(0);
    }
  });
});
