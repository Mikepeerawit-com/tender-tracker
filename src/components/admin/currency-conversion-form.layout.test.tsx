import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import "@/app/globals.css";

import { CurrencyConversionForm } from "@/components/admin/currency-conversion-form";
import en from "@/messages/en.json";
import zhHans from "@/messages/zh-Hans.json";
import { expectNoSidewaysScroll, phone } from "@/test/layout";

/**
 * The FX Buffer form **while it is refusing a figure**, which is a taller and wider form
 * than the one it opens as.
 *
 * The same argument `locale-switcher.layout.test.tsx` makes: the state at risk does not
 * exist until something is pressed. At rest this screen is a short box, a `%` and one
 * button; after a refusal it is all of that plus the longest sentence in the namespace,
 * sharing a wrapping row with the button. A form that only fits before it is used is one
 * nobody measured.
 *
 * `out_of_range` is the refusal measured because it is the longest of the five in both
 * locales, and because it is the one an admin is most likely to meet — it is what a 2
 * typed as 200 comes back as.
 *
 * Both locales, for the reason every suite here gives: a Han glyph is about twice the
 * width of a Latin letter, so a shorter Chinese string is not a narrower one.
 */
vi.mock("@/app/actions/admin", () => ({
  setFxBufferAction: async () => ({ status: "out_of_range" }),
}));

const locales = [
  ["en", en],
  ["zh-Hans", zhHans],
] as const;

describe(`the foreign-price setting at ${phone.width}×${phone.height}`, () => {
  it.each(locales)("does not scroll sideways, in %s", async (locale, messages) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
        <CurrencyConversionForm percent={2} />
      </NextIntlClientProvider>,
    );

    expectNoSidewaysScroll();

    await userEvent.click(
      screen.getByRole("button", { name: messages.currencyConversion.save }),
    );

    // Not a DOM assertion for its own sake — `vitest.config.mts` keeps those in the
    // jsdom project. It is what makes the measurement below the one this file claims to
    // take: without it the suite would happily measure the resting form and report green
    // on a refusal that never rendered.
    expect(await screen.findByRole("status")).toHaveTextContent(
      messages.currencyConversion.status.out_of_range,
    );

    expectNoSidewaysScroll();
  });
});
