import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import "@/app/globals.css";

import en from "@/messages/en.json";
import zhHans from "@/messages/zh-Hans.json";

import { AppHeader } from "./app-header";
import { controlRows, expectNoSidewaysScroll, phone } from "@/test/layout";

/**
 * The bar that is on every screen, at the width #56 was reported at.
 *
 * This is the guard ADR-0009's failure bar always implied and never had: the working
 * sheet's own layout test renders the sheet *without* the app shell, so a header that
 * pushed every page sideways sat outside everything the suite measured. Hand-check 1 of
 * #48 reported the tender list, a Tender **and** the comparison sheet all wider than the
 * phone — one symptom on three screens is one cause on the thing all three share.
 *
 * The admin case is the one that matters. An org admin's bar carries six buttons —
 * Tenders, People, Group Robot, the two locales and Sign out — and `Button` is
 * `shrink-0 whitespace-nowrap`, so none of them gives up a pixel.
 *
 * Both locales are measured, because the labels are translated and English is not
 * automatically the worst case: a Han glyph is about twice the width of a Latin letter,
 * so a shorter Chinese string is not necessarily a narrower button. The locale is handed
 * to the provider alongside its messages rather than pinned to `en` — `LocaleSwitcher`
 * reads `useLocale()` to decide which of its two buttons is `default` variant and which
 * is `outline`, and those are not the same width.
 */
vi.mock("@/app/actions/auth", () => ({ signOutAction: async () => ({}) }));
vi.mock("@/app/actions/locale", () => ({ switchLocale: async () => ({}) }));

const locales = [
  ["en", en, "Somchai Prasertkul"],
  ["zh-Hans", zhHans, "张伟明"],
  // A member's display name is whatever they were enrolled as, and nothing obliges it to
  // contain a space. It does not currently fail on its own — the left group wraps and the
  // name still fits a line — but it is a real input shape and cheap to keep measured.
  ["en", en, "SomchaiPrasertkulwattanachaiwong"],
] as const;

describe(`the app header at ${phone.width}×${phone.height}`, () => {
  it.each(
    locales.flatMap(([locale, messages, name]) =>
      [
        ["an org admin, who gets the two admin buttons", true],
        ["an ordinary member", false],
      ].map(
        ([who, isOrgAdmin]) =>
          [`${who}, ${name} in ${locale}`, isOrgAdmin as boolean, locale, messages, name] as const,
      ),
    ),
  )("does not push the page sideways for %s", (_case, isOrgAdmin, locale, messages, name) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
        <AppHeader name={name} isOrgAdmin={isOrgAdmin} />
      </NextIntlClientProvider>,
    );

    expectNoSidewaysScroll();

    // And the half the overflow check cannot see. A bar allowed to wrap never overflows,
    // it just gets taller: the first fix for #56 did that and spent three of the phone's
    // rows on navigation, which is what this pins shut.
    expect(controlRows(document.querySelector("header")!)).toBe(1);
  });
});
