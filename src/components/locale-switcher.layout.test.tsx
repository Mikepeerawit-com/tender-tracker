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
 * Switching used to show nothing but two greyed-out buttons, and #48's hand-check read
 * that exactly as it looks — a change with no sign anything was happening (#57). The fix
 * is a spinner on the button that was pressed, and a spinner is 14px plus a gap that the
 * bar did not previously have to find.
 *
 * That is the whole reason this file exists rather than another case in
 * `screens.layout.test.tsx`. Every other measurement in this repo renders a screen and
 * measures it; this one has to *press something first*, because the state at risk does
 * not exist until then. A control that only fits before it is pressed is a control nobody
 * measured, and #56 is what that costs on a bar this full: an org admin, whose six admin
 * buttons make the worst case, in both locales, since a Han glyph is about twice the
 * width of a Latin letter.
 *
 * `switchLocale` is stubbed with a promise that never settles. That is not a shortcut
 * around timing — it is the only way to hold `isPending` open long enough to measure it,
 * and it is honest about what is being measured: the state a phone on mobile data sits in
 * for as long as the round trip takes.
 */

vi.mock("@/app/actions/auth", () => ({ signOutAction: async () => ({}) }));
vi.mock("@/app/actions/locale", () => ({
  switchLocale: () => new Promise(() => {}),
}));

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

    // The language that is *not* current, which is the only one anybody presses.
    const target = locale === "en" ? messages.localeSwitcher.short["zh-Hans"] : messages.localeSwitcher.short.en;

    await userEvent.click(screen.getByRole("button", { name: target }));

    // The transition is open and will not close, so this is the bar as it is while the
    // server is being waited on.
    expect(screen.getByRole("status")).toHaveTextContent(messages.localeSwitcher.switching);

    expectNoSidewaysScroll();
    expect(controlRows(document.querySelector("header")!)).toBe(1);
  });

  it("keeps both languages on screen while one of them is being switched to", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Bangkok">
        <AppHeader name="Somchai Prasertkul" isOrgAdmin />
      </NextIntlClientProvider>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: en.localeSwitcher.short["zh-Hans"] }),
    );

    // The constraint documented on the component, and the one a spinner is most likely to
    // be traded against: whoever cannot read the language they are looking at has to be
    // able to see the way out of it, including during the second they are waiting.
    for (const label of [en.localeSwitcher.short.en, en.localeSwitcher.short["zh-Hans"]]) {
      const button = screen.getByRole("button", { name: label });

      expect(button).toBeVisible();
      expect(button.offsetWidth).toBeGreaterThan(0);
    }

    // And the spinner is on the one being switched *to*, not the one already current.
    const switchingTo = screen.getByRole("button", {
      name: en.localeSwitcher.short["zh-Hans"],
    });

    expect(switchingTo.querySelector(".animate-spin")).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: en.localeSwitcher.short.en })
        .querySelector(".animate-spin"),
    ).toBeNull();
  });
});
