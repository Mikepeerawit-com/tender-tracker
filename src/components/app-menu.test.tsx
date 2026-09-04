import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import en from "@/messages/en.json";
import zhHans from "@/messages/zh-Hans.json";

import { AppMenu } from "./app-menu";

/**
 * **What is behind the trigger, once it is opened** (#132).
 *
 * The menu held four rows for an Org Admin — People, the Group Robot, Converting foreign
 * prices, then Sign out — and one row for everybody else. This is the assertion that the
 * three are gone and that one `Settings` row stands in their place, which is the change
 * the ticket is named for; nothing else in the repo can see inside this popup, because it
 * does not exist in the tree until something is pressed.
 *
 * **The whole list, in order, rather than the presence of `Settings`.** An admin row left
 * behind beside the new one passes a presence check perfectly.
 *
 * The rows are the same for every member and there is no longer a prop that could make
 * them otherwise — which is the point, and is why this suite has one case per locale
 * rather than one per reader.
 *
 * **Opened from the keyboard, and that is a jsdom fact rather than a preference.** The
 * trigger opens on `pointerdown`, and jsdom has no `PointerEvent` — a click leaves
 * `aria-expanded="false"` and the popup unwritten. `Enter` on the focused trigger is the
 * path that works there, and it is a path a reader really takes: this bar has to be
 * workable from the keyboard at the desk.
 */
vi.mock("@/app/actions/auth", () => ({ signOutAction: async () => ({}) }));

/** The trigger, focused and pressed. See the note above on why not a click. */
async function open(messages: typeof en): Promise<void> {
  screen.getByRole("button", { name: messages.nav.menu }).focus();

  await userEvent.keyboard("{Enter}");
}

describe.each([
  ["en", en],
  ["zh-Hans", zhHans],
])("the app menu, in %s", (locale, messages) => {
  it("holds Settings and Sign out, and nothing else", async () => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
        <AppMenu />
      </NextIntlClientProvider>,
    );

    await open(messages);

    expect(
      screen.getAllByRole("menuitem").map((item) => (item.textContent ?? "").trim()),
    ).toEqual([messages.nav.settings, messages.nav.signOut]);
  });

  it("sends Settings to the one destination the three screens now live under", async () => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
        <AppMenu />
      </NextIntlClientProvider>,
    );

    await open(messages);

    expect(
      screen.getByRole("menuitem", { name: messages.nav.settings }).getAttribute("href"),
    ).toBe("/settings");
  });
});
