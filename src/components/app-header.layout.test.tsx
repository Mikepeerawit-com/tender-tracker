import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import "@/app/globals.css";

import en from "@/messages/en.json";
import zhHans from "@/messages/zh-Hans.json";

import { AppHeader, type AppLocation } from "./app-header";
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
 * **There is one bar, for everybody, since #132.** It used to have two shapes — an org
 * admin's, whose menu held People, Group Robot and Converting foreign prices as well as
 * Sign out, and a member's, whose menu held one row — so this suite ran every case twice
 * and the admin's was the one that mattered. Those three are one `Settings` row now and
 * the language switcher has left the bar for Preferences, so the widest bar there is is
 * the only bar there is: a location, the two destinations above `md`, and one menu
 * trigger. `Button` is `shrink-0 whitespace-nowrap`, so none of them gives up a pixel.
 *
 * Since #73 the bar also states **where the reader is**, which gives it two shapes and a
 * new way to overflow: the `record` shape carries a back control plus a reference and a
 * client name, and neither of those is a string this app chose. They are measured here in
 * the unbroken form a client really supplies, because that is the one that pushes.
 *
 * Both locales are measured, because the labels are translated and English is not
 * automatically the worst case: a Han glyph is about twice the width of a Latin letter,
 * so a shorter Chinese string is not necessarily a narrower button.
 */
vi.mock("@/app/actions/auth", () => ({ signOutAction: async () => ({}) }));

const locales = [
  ["en", en],
  ["zh-Hans", zhHans],
] as const;

/**
 * The shapes the bar has, and the widths it has to survive in each.
 *
 * A reference and a client name are whatever the client calls them, and neither has to
 * contain a space — the unbroken pair is not invented for the test. The sourcing screen's
 * form is the longest of all, since it names the Item after the client.
 */
const locations = [
  ["the wordmark, on a screen about no one record", undefined],
  [
    "a Tender, named by its reference and client",
    {
      kind: "record",
      backHref: "/tenders",
      reference: "TR-2026-0142",
      detail: "Bangkok Metropolitan Administration",
    },
  ],
  [
    "a Tender whose reference and client have nowhere to wrap",
    {
      kind: "record",
      backHref: "/tenders",
      reference: "TR20260142MOPHDMSCENTRALPROCUREMENT0098",
      detail: "ChulalongkornMemorialHospitalProcurementDepartment",
    },
  ],
  [
    "an Item being sourced, which names the client and the Item too",
    {
      kind: "record",
      backHref: "/tenders/8f14e45f",
      reference: "TR20260142MOPHDMSCENTRALPROCUREMENT0098",
      detail:
        "ChulalongkornMemorialHospitalProcurementDepartment · NitrileExaminationGlovesPowderFreeSizeMediumNonSterile",
    },
  ],
] as const satisfies readonly (readonly [string, AppLocation | undefined])[];

describe(`the app header at ${phone.width}×${phone.height}`, () => {
  it.each(
    locales.flatMap(([locale, messages]) =>
      locations.map(
        ([where, location]) =>
          [`${where}, in ${locale}`, locale, messages, location] as const,
      ),
    ),
  )("does not push the page sideways on %s", (_case, locale, messages, location) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
        <AppHeader location={location} />
      </NextIntlClientProvider>,
    );

    expectNoSidewaysScroll();

    // And the half the overflow check cannot see. A bar allowed to wrap never overflows,
    // it just gets taller: the first fix for #56 did that and spent three of the phone's
    // rows on navigation, which is what this pins shut.
    expect(controlRows(document.querySelector("header")!)).toBe(1);

    // The language switcher is **not** here (#132). It left for Preferences, and this is
    // the row it left — a control put back on the bar would take its width back with it,
    // and the one-row assertion above would go on passing until the day it did not.
    expect(
      screen.queryByRole("navigation", { name: messages.localeSwitcher.label }),
    ).toBeNull();
  });
});
