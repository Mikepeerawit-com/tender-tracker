import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import "@/app/globals.css";

import en from "@/messages/en.json";
import zhHans from "@/messages/zh-Hans.json";

import { desk, expectNoSidewaysScroll, phone } from "@/test/layout";

import { AuthScreen } from "./auth-screen";
import { LoginForm } from "./login-form";

/**
 * **The signed-out screens stay a narrow centred column, at every width** (ADR-0021, #97).
 *
 * #97 gave the Owner's two screens the desk they are read at, and the risk in a ticket
 * shaped like that is that *wider* reads as *better* and everything follows the change. It
 * does not: login, set-password and choose-language are a handful of fields, and a
 * five-field form stretched across a monitor is worse than one that stays where the eye
 * already is. So the column that must not move is measured too, at the same desk — a rule
 * nothing asserts is a rule the next ticket does not know about (ADR-0016).
 *
 * **`AuthScreen`, not the three pages.** They are `async` Server Components and no browser
 * test can reach them; what they share is this wrapper, and its `max-w-sm` is the whole of
 * the claim. A page that stopped composing `AuthScreen` altogether would slip past this,
 * which is the same limit every suite in this project has and the reason these wrappers
 * are components at all.
 *
 * `LoginForm` is inside it because a column measured around nothing measures nothing: it
 * is the busiest of the three forms, and the one whose error banner and 44px controls have
 * to fit the phone as well.
 *
 * Both locales, for the reason #56 gives: a Han glyph is about twice the width of a Latin
 * letter, so a shorter Chinese string is not automatically a narrower control.
 */
vi.mock("@/app/actions/auth", () => ({ signInAction: async () => ({}) }));
vi.mock("@/app/actions/locale", () => ({ switchLocale: async () => ({}) }));

/**
 * The two locales, declared here rather than taken from `@/test/screens`.
 *
 * That module composes whole `(app)` screens, so importing it for one constant would pull
 * the signed-in half of the app — the app bar, its menu, the sign-out action — into a
 * suite about the screens you reach *before* signing in.
 */
const locales = [
  ["en", en],
  ["zh-Hans", zhHans],
] as const;

/** `max-w-sm`, the width `AuthScreen` commits to and the number this suite is about. */
const narrowColumn = 384;

describe("a signed-out screen", () => {
  // The layout project's viewport is the phone and every other suite in it depends on
  // that, so whatever this does to the window is undone before the next file runs.
  afterEach(async () => {
    await page.viewport(phone.width, phone.height);
  });

  it.each(locales)(
    `stays a narrow centred column at ${desk.width}×${desk.height}: in %s`,
    async (locale, m) => {
      await page.viewport(desk.width, desk.height);
      renderLogin(locale, m);

      const column = document.querySelector("main")!.getBoundingClientRect();

      expect(column.width).toBe(narrowColumn);
      // Centred, not merely narrow: a column pinned to the left of a 1440px window is the
      // other way to fail this and measures the same width.
      //
      // Against the width the page was *laid out* in rather than `desk.width`. The two
      // differ by a scrollbar the moment this screen grows past 900px tall — one more
      // field, a longer `zh-Hans` line, the error banner the form draws — and a centred
      // column would then fail an assertion that has nothing to do with centring.
      const laidOutIn = document.documentElement.clientWidth;

      expect(Math.round(column.left)).toBe(Math.round(laidOutIn - column.right));
    },
  );

  it.each(locales)(
    `fills the phone at ${phone.width}×${phone.height}: in %s`,
    async (locale, m) => {
      await page.viewport(phone.width, phone.height);
      renderLogin(locale, m);

      // The same cap, below it: 390px less the wrapper's `p-6` either side. This is the
      // half that says the column is a cap rather than a fixed width — a `w-sm` would
      // measure 384 here and push the page sideways.
      expect(document.querySelector("main")!.getBoundingClientRect().width).toBe(
        phone.width - 48,
      );
      expectNoSidewaysScroll();
    },
  );
});

function renderLogin(locale: string, m: typeof en) {
  render(
    <NextIntlClientProvider locale={locale} messages={m} timeZone="Asia/Bangkok">
      <AuthScreen title={m.login.title} description={m.login.description}>
        <LoginForm />
      </AuthScreen>
    </NextIntlClientProvider>,
  );
}
