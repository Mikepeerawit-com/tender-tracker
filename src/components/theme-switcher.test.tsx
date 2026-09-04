import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { ThemeSwitcher } from "@/components/theme-switcher";
import en from "@/messages/en.json";

/**
 * The half of the theme control that only exists once it is interactive.
 *
 * The palette itself is not asked about here and cannot be: jsdom has no layout engine and
 * no cascade to speak of, so what a token resolves to under `prefers-color-scheme` is a
 * question for a real browser and is asked next door in `theme.layout.test.tsx`. What is
 * asked here is what the *control* does — which option it says is current, which one spins
 * when pressed, and whether all three stay reachable while it does.
 *
 * `switchTheme` is stubbed with a promise that never settles, which is the only way to hold
 * `isPending` open long enough to look at it.
 */

vi.mock("@/app/actions/theme", () => ({
  switchTheme: () => new Promise(() => {}),
}));

function drawSwitcher(current: "system" | "light" | "dark" = "system") {
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Bangkok">
      <ThemeSwitcher current={current} />
    </NextIntlClientProvider>,
  );
}

const option = (label: string) => screen.getByRole("button", { name: label });
const spinner = (label: string) => option(label).querySelector(".animate-spin");

/** Every answer the control is currently offering, in the order it draws them. */
const optionNames = () =>
  screen.getAllByRole("button").map((button) => (button.textContent ?? "").trim());

describe("the theme control", () => {
  it("offers System as well as the two pinned themes", () => {
    drawSwitcher();

    // A control offering light and dark alone would leave a reader who wants to follow
    // their phone with nothing to press — and no way back once they had pressed either.
    //
    // Asserted as the whole list rather than as three lookups: `getByRole` throws on a
    // missing option, so a `toBeDefined()` after it is an expectation with no failing
    // state (ADR-0016). A fourth option, or the three in an order that buried System, is
    // what this can still fail on.
    expect(optionNames()).toEqual([
      en.themeSwitcher.system,
      en.themeSwitcher.light,
      en.themeSwitcher.dark,
    ]);
  });

  it("says which one the page is painted in", () => {
    drawSwitcher("dark");

    // `aria-current` rather than the filled variant alone: which button looks different is
    // not something a screen reader can be told by a colour.
    expect(option(en.themeSwitcher.dark).getAttribute("aria-current")).toBe("true");
    expect(option(en.themeSwitcher.system).getAttribute("aria-current")).toBe("false");
  });
});

describe("switching theme", () => {
  async function pressDark() {
    drawSwitcher();
    await userEvent.click(option(en.themeSwitcher.dark));
  }

  it("spins the option that was pressed, and not the others", async () => {
    await pressDark();

    // Which one spins cannot be derived from `isPending`, which says only that *a*
    // transition is running. Getting it wrong puts the spinner on the theme the reader is
    // already in, i.e. on the one they are trying to leave.
    expect(spinner(en.themeSwitcher.dark)).not.toBeNull();
    expect(spinner(en.themeSwitcher.system)).toBeNull();
    expect(spinner(en.themeSwitcher.light)).toBeNull();
  });

  it("says a change is under way, for a reader who cannot see the spinner", async () => {
    await pressDark();

    // The spinner is `aria-hidden`, so this sentence is the whole of the announcement.
    expect(screen.getByRole("status").textContent).toBe(en.themeSwitcher.switching);
  });

  it("keeps all three answers on screen while one is being switched to", async () => {
    await pressDark();

    // The round trip happens on a phone network inside the WeCom webview, and it is the
    // length of it that this is about. Every option is `disabled` for that stretch — the
    // reader cannot press anything, which is deliberate, since a second choice landing
    // mid-flight would race the first — so what has to survive is that the control still
    // *says* what the answers are and which one is being switched to. A control that
    // collapsed to the pressed option and a spinner would leave a reader who pressed the
    // wrong one looking at a screen with no way back on it.
    expect(optionNames()).toEqual([
      en.themeSwitcher.system,
      en.themeSwitcher.light,
      en.themeSwitcher.dark,
    ]);
  });
});
