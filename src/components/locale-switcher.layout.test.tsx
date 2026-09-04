import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import "@/app/globals.css";

import { AuthScreen } from "@/components/auth/auth-screen";
import { LoginForm } from "@/components/auth/login-form";
import { locales, type Messages, Screen, screens } from "@/test/screens";
import { expectNoSidewaysScroll, phone } from "@/test/layout";

/**
 * The switcher **while a language is being switched**, on both screens that draw it.
 *
 * The switch puts a spinner on the button that was pressed (#57), which is 14px plus a gap
 * that was not there before. That is the whole reason this file exists rather than another
 * case in `screens.layout.test.tsx`: every other measurement in this repo renders a screen
 * and measures it, and this one has to *press something first*, because the state at risk
 * does not exist until then — a control only wide enough before it is pressed is one
 * nobody measured.
 *
 * **What it measures moved in #132.** It stood at the app bar, where #56 was the bill for
 * running out of width. The switcher has left the bar: behind the login it is on the
 * Preferences screen, and in front of it it is still in `AuthScreen`'s footer, as
 * prominent as it ever was — the argument that put it there is about a reader who cannot
 * read the form they are looking at, and signing in is exactly where that reader is. Both
 * are measured, because the risk is the control's own width and it is now drawn in two
 * places rather than one.
 *
 * The Preferences screen is taken from the shared screen record rather than composed here,
 * so this suite and the guards that walk that record cannot end up measuring two different
 * screens. The sign-in screen is composed by hand because it is not in that record and
 * cannot be: every entry there is an `(app)` screen with the app bar and the bottom bar
 * around it, and a signed-out screen has neither. `auth-screen.layout.test.tsx` and
 * `contrast.layout.test.tsx` compose the same two lines for the same reason.
 *
 * Both locales, since a Han glyph is about twice the width of a Latin letter and 简体中文
 * is not the same width as English.
 *
 * `switchLocale` is stubbed with a promise that never settles — not a shortcut around
 * timing, but the only way to hold `isPending` open long enough to measure it, and an
 * honest model of what a phone on mobile data sits in for the length of the round trip.
 */

vi.mock("@/app/actions/locale", () => ({ switchLocale: () => new Promise(() => {}) }));

describe(`switching language at ${phone.width}×${phone.height}`, () => {
  it.each(locales)("does not push Preferences sideways, in %s", async (locale, messages) => {
    render(
      <Screen locale={locale} messages={messages}>
        {screens(messages)["the Preferences screen"].body}
      </Screen>,
    );

    await pressTheOtherLanguage(locale, messages);
    expectBothLanguagesReachable(messages);
    expectNoSidewaysScroll();
  });

  it.each(locales)("does not push the sign-in screen sideways, in %s", async (locale, messages) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
        <AuthScreen title={messages.login.title} description={messages.login.description}>
          <LoginForm />
        </AuthScreen>
      </NextIntlClientProvider>,
    );

    await pressTheOtherLanguage(locale, messages);
    expectBothLanguagesReachable(messages);
    expectNoSidewaysScroll();
  });
});

/** The language that is *not* current, which is the only one anybody presses. */
async function pressTheOtherLanguage(locale: string, messages: Messages) {
  const target =
    locale === "en" ? messages.localeSwitcher["zh-Hans"] : messages.localeSwitcher.en;

  await userEvent.click(screen.getByRole("button", { name: target }));
}

/**
 * Both languages keep a box somebody can hit, mid-switch, in both places this is drawn.
 *
 * **Both still on screen** is the constraint the spinner's extra 14px would be traded
 * against if the row it sits in ever ran short: whoever cannot read the language they are
 * looking at has to be able to find the way out of it, including during the wait.
 *
 * **And both still thumb-sized**, which is buildspec_2's 44px floor and the whole of what
 * "prominent" meant when that was a prop of this component. #132 collapsed the two shapes
 * into one and the shape it kept is this one; the floor is asserted rather than assumed,
 * because the way a control gets quietly shrunk is a class edit nothing was measuring.
 */
function expectBothLanguagesReachable(messages: Messages): void {
  for (const label of [messages.localeSwitcher.en, messages.localeSwitcher["zh-Hans"]]) {
    const button = screen.getByRole("button", { name: label });

    expect(button.offsetWidth).toBeGreaterThan(0);
    expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
}
