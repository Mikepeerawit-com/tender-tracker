import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { LocaleSwitcher } from "@/components/locale-switcher";
import en from "@/messages/en.json";

/**
 * The half of the switcher that only exists once it is interactive: which button is
 * spinning, and what the live region says while it does.
 *
 * Switching used to set nothing but `disabled` — two buttons greying out, and no sign
 * that work was under way, which is exactly how #48's hand-check read it (#57).
 *
 * This is the jsdom seam and holds only what jsdom can answer: which elements are in the
 * tree and what they contain. Whether the bar those buttons sit in still *fits* once a
 * spinner is in it is a question about layout, and jsdom reports every width as `0` — so
 * it is asked next door, in `locale-switcher.layout.test.tsx`, in a real browser.
 *
 * `switchLocale` is stubbed with a promise that never settles, which is the only way to
 * hold `isPending` open long enough to look at it.
 */

vi.mock("@/app/actions/locale", () => ({ switchLocale: () => new Promise(() => {}) }));

async function pressTheOtherLanguage() {
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Bangkok">
      <LocaleSwitcher />
    </NextIntlClientProvider>,
  );

  await userEvent.click(
    screen.getByRole("button", { name: en.localeSwitcher["zh-Hans"] }),
  );
}

const spinner = (label: string) =>
  screen.getByRole("button", { name: label }).querySelector(".animate-spin");

describe("switching language", () => {
  it("spins the button that was pressed, and not the other one", async () => {
    await pressTheOtherLanguage();

    // Which one spins cannot be derived from `isPending`, which says only that *a*
    // transition is running. Getting this wrong puts the spinner on the language the
    // reader is already in, i.e. on the one they are trying to leave.
    expect(spinner(en.localeSwitcher["zh-Hans"])).not.toBeNull();
    expect(spinner(en.localeSwitcher.en)).toBeNull();
  });

  it("says a switch is under way, for a reader who cannot see the spinner", async () => {
    await pressTheOtherLanguage();

    // The spinner is `aria-hidden`, so this sentence is the whole of the announcement.
    expect(screen.getByRole("status").textContent).toBe(en.localeSwitcher.switching);
  });

  it("keeps both languages on offer while one is being switched to", async () => {
    await pressTheOtherLanguage();

    // The constraint documented on the component, and the one a spinner is most likely to
    // be traded against: whoever cannot read the language they are looking at has to be
    // able to find the way out of it, including during the wait.
    for (const label of [en.localeSwitcher.en, en.localeSwitcher["zh-Hans"]]) {
      expect(screen.getByRole("button", { name: label })).toBeDefined();
    }
  });
});
