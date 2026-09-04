import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp } from "vitest/browser";

import { describeElement, drawn } from "@/test/layout";
import {
  locales,
  Screen,
  screens,
  signedOutScreens,
  SignedOut,
} from "@/test/screens";

/**
 * **Nothing moves on a screen whose reader asked for nothing to move.**
 *
 * `prefers-reduced-motion` is not a preference about taste. It is set by people for whom
 * movement on a screen causes nausea, migraine or vertigo, and an app that ignores it does
 * not merely look busy to them — it costs them the use of it. So the claim is the strong
 * one: with the preference set, no element on any screen in the record is animating and no
 * property on it is transitioning.
 *
 * **The operating system is emulated over CDP**, which is the same mechanism and the same
 * reset `theme.layout.test.tsx` uses, and for the same reason: the preference is a media
 * query, so the only place the app's answer to it is true or false is a browser with an
 * opinion the page cannot see coming. Emulation is per page rather than per test, which is
 * what the `afterEach` is for — a file that left it set would decide the answer for
 * whichever one ran next.
 *
 * **One theme and one locale**, deliberately. Motion is neither repainted nor translated:
 * the durations are written once, in one unlayered block, and no `dark:` or `:lang()` rule
 * in this app touches a `transition` or an `animation`. Walking the other three
 * combinations would be three times the browser time for the same assertion.
 *
 * **It can fail, and the second suite is where that is shown** (ADR-0016). A guard that
 * asserts *no movement* is passed perfectly by an app with no movement in it at all, and
 * this app has some: the loading fallback pulses and both switchers spin. So the same
 * screens are asked the opposite question with the preference *unset*, and at least one of
 * them has to be moving — which is what makes the silence above evidence.
 */

const [[locale, messages]] = locales;

/**
 * Never settles, which is the only way to hold a spinner on screen long enough to ask
 * about it — the same trick, for the same reason, that `theme-switcher.layout.test.tsx`
 * uses to measure the row the spinner widens.
 *
 * Registered after the shared stub in `vitest.setup.layout.ts` and therefore beating it.
 */
vi.mock("@/app/actions/theme", () => ({ switchTheme: () => new Promise(() => {}) }));

/** What the operating system says it wants, for the length of one test. */
async function deviceAsksForStillness(): Promise<void> {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
}

afterEach(async () => {
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

describe("a reader who asked for reduced motion", () => {
  it.each(Object.entries(screens(messages)).map(([name, entry]) => [name, entry.body]))(
    "is shown nothing that moves on %s",
    async (name, body) => {
      await deviceAsksForStillness();

      const { container } = render(
        <Screen locale={locale} messages={messages}>
          {body}
        </Screen>,
      );

      expectNothingMoves(container, name);
    },
  );

  /** And the four screens reached before signing in, which the record above does not hold. */
  it.each(
    Object.entries(signedOutScreens(messages)).map(
      ([name, entry]) => [name, entry.body] as const,
    ),
  )("is shown nothing that moves on %s", async (name, body) => {
    await deviceAsksForStillness();

    const { container } = render(
      <SignedOut locale={locale} messages={messages}>
        {body}
      </SignedOut>,
    );

    expectNothingMoves(container, name);
  });

  /**
   * **And the one thing on a screen that moves only once somebody presses it.**
   *
   * Every case above photographs a screen at rest, and at rest the loudest motion in this
   * app is not on any of them: the switchers put a spinning `Loader2` inside the control
   * that was pressed, and it exists for exactly as long as a server action is in flight.
   * The app-wide rule stills it by the same declaration that stills the skeleton's pulse —
   * but a rule is stated in one place and read in many, and *"the pending spinners turned
   * regardless"* is the sentence in `globals.css` this change is answering. A claim about
   * a spinner is worth a test that has a spinner in it.
   */
  it("is shown a switcher that does not spin while it waits", async () => {
    await deviceAsksForStillness();

    const user = userEvent.setup();

    const { container } = render(
      <Screen locale={locale} messages={messages}>
        {screens(messages)["the Preferences screen"].body}
      </Screen>,
    );

    await user.click(screen.getByRole("button", { name: messages.themeSwitcher.dark }));

    // The spinner really is on screen, so this cannot pass by pressing nothing.
    expect(container.querySelector(".animate-spin")).not.toBeNull();

    expectNothingMoves(container, "the Preferences screen, mid-press");
  });
});

/** Nothing on this screen is animating, and nothing on it is transitioning. */
function expectNothingMoves(container: HTMLElement, name: string): void {
  // A screen that drew nothing would pass every assertion below in silence.
  const elements = [...container.querySelectorAll<HTMLElement>("*")].filter(drawn);

  expect(elements.length, `${name} drew nothing`).toBeGreaterThan(0);

  expect(elements.filter(moves).map(describeElement), name).toEqual([]);

  // And the same claim asked of the engine rather than of the stylesheet. A transition or
  // a keyframe animation that was somehow still running would be in here whatever the
  // computed durations said, which is the half a declaration walk cannot see.
  expect(
    document.getAnimations().map((animation) => animation.constructor.name),
    `${name} has something running`,
  ).toEqual([]);
}

/**
 * The same screens with nothing asked of them, which is what makes the suite above mean
 * something.
 *
 * It names no screen: what has to be true is that the app *can* move, not that a
 * particular thing does. The loading fallback's pulse is today's answer and it is free to
 * move to another screen without this needing an edit — and if the day comes that the app
 * has no motion in it at all, this goes red and says so, rather than leaving the guard
 * above passing about nothing.
 */
describe("a reader who asked for nothing", () => {
  it("is shown an app that does move, which is what the guard above is guarding", () => {
    const moving = Object.entries(screens(messages)).flatMap(([name, entry]) => {
      const { container, unmount } = render(
        <Screen locale={locale} messages={messages}>
          {entry.body}
        </Screen>,
      );

      const found = [...container.querySelectorAll<HTMLElement>("*")]
        .filter(drawn)
        .filter(moves)
        .map((element) => `${name}: ${describeElement(element)}`);

      unmount();

      return found;
    });

    expect(moving.length).toBeGreaterThan(0);
  });
});

/** Whether this element would animate or transition anything at all. */
function moves(element: HTMLElement): boolean {
  return [null, "::before", "::after"].some((part) => {
    const style = getComputedStyle(element, part);

    return (
      (style.animationName !== "none" && seconds(style.animationDuration) > 0) ||
      seconds(style.transitionDuration) > 0
    );
  });
}

/**
 * The longest of a comma-separated duration list, in seconds.
 *
 * A list, because `transition-duration` carries one entry per transitioned property and a
 * rule that zeroed the first and left the second is a rule that did not work.
 */
function seconds(durations: string): number {
  return Math.max(
    ...durations.split(",").map((duration) => {
      const value = Number.parseFloat(duration);

      return duration.trim().endsWith("ms") ? value / 1000 : value;
    }),
  );
}
