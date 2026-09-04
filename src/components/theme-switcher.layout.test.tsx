import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "@/app/globals.css";

import { locales, type Messages, Screen, screens } from "@/test/screens";
import { controlRows, expectNoSidewaysScroll, phone } from "@/test/layout";

/**
 * **Three thumb-sized targets in one row, at 390px, in both scripts.**
 *
 * The language switcher is two options and had to be measured mid-press because a spinner
 * appears inside the button that was pressed (#57). This control is that row plus one, on
 * the same screen and inside the same measure — so it is the widest thing Preferences
 * draws and the first row on it that would quietly wrap when a translation grows. 跟随系统
 * is four Han glyphs against English's one word, and a Han glyph is about twice the width
 * of a Latin letter, so neither locale is the worst case for the other.
 *
 * **One row is asserted rather than left to `expectNoSidewaysScroll`**, which is the fault
 * #56 got through on: a row allowed to wrap never overflows, it just gets taller. It would
 * still be a legible screen — which is why the control keeps `flex-wrap` rather than a
 * `nowrap` that would push the page sideways — but a stack of three full-width answers is
 * a different control from a row of three, and it should be a decision rather than a
 * translation's side effect.
 *
 * Measured mid-press for the reason the language suite gives: the spinner is 14px plus a
 * gap that does not exist until somebody presses something.
 */

// Hoisted per file and therefore not shareable, the way every other renderer of
// `@/test/screens` declares its own. See the note in that file.
vi.mock("@/app/actions/auth", () => ({
  signOutAction: async () => ({}),
  signInAction: async () => ({}),
}));
vi.mock("@/app/actions/admin", () => ({
  inviteAction: async () => ({}),
  setWecomUseridAction: async () => ({}),
  sendTestMentionAction: async () => ({}),
  setMembershipDisabledAction: async () => ({}),
  setGroupRobotAction: async () => ({}),
  setFxBufferAction: async () => ({}),
}));
vi.mock("@/app/actions/locale", () => ({ switchLocale: async () => ({}) }));
vi.mock("@/app/actions/tenders", () => ({
  addAssigneeAction: async () => ({}),
  removeAssigneeAction: async () => ({}),
}));
vi.mock("@/app/actions/quotes", () => ({
  createQuoteAction: async () => ({}),
  updateQuoteAction: async () => ({}),
  deleteQuoteAction: async () => ({}),
  recordNoSupplierFoundAction: async () => ({}),
  clearNoSupplierFoundAction: async () => ({}),
}));
vi.mock("@/app/actions/quote-photos", () => ({
  recordQuotePhotosAction: async () => ({}),
  removeQuotePhotoAction: async () => ({}),
  signQuotePhotoUploadsAction: async () => ({}),
}));
// Never settles, which is the only way to hold the spinner on screen long enough to
// measure the row it widened.
vi.mock("@/app/actions/theme", () => ({
  switchTheme: () => new Promise(() => {}),
}));

describe(`choosing a theme at ${phone.width}×${phone.height}`, () => {
  it.each(locales)(
    "keeps all three answers on one row, in %s",
    async (locale, messages) => {
      const control = await pressDark(locale, messages);

      expect(controlRows(control)).toBe(1);
      expectNoSidewaysScroll();
    },
  );

  it.each(locales)(
    "keeps every one of them thumb-sized, in %s",
    async (locale, messages) => {
      await pressDark(locale, messages);

      // buildspec_2's 44px floor, asserted rather than assumed: the way a control gets
      // quietly shrunk is a class edit nothing was measuring.
      for (const answer of ["system", "light", "dark"] as const) {
        const option = screen.getByRole("button", {
          name: messages.themeSwitcher[answer],
        });

        expect(option.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      }
    },
  );
});

/** The Preferences screen with dark being switched to, and the control that draws it. */
async function pressDark(
  locale: (typeof locales)[number][0],
  messages: Messages,
): Promise<HTMLElement> {
  render(
    <Screen locale={locale} messages={messages}>
      {screens(messages)["the Preferences screen"].body}
    </Screen>,
  );

  await userEvent.click(
    screen.getByRole("button", { name: messages.themeSwitcher.dark }),
  );

  return screen.getByRole("navigation", { name: messages.themeSwitcher.label });
}
