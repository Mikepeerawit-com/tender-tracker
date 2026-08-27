import { render } from "@testing-library/react";
import { describe, it } from "vitest";

import "@/app/globals.css";

import en from "@/messages/en.json";
import zhHans from "@/messages/zh-Hans.json";
import { expectNoSidewaysScroll, phone } from "@/test/layout";

import { Button } from "./button";
import { ScreenHeader } from "./screen-header";

/**
 * All three screen headers, at the width #56 was reported at.
 *
 * None of the three screens had ever been measured — every page is an `async` Server
 * Component, two of them behind a layout that gates on `currentUser`, so nothing in the
 * suite could reach them. They share this component now, so one guard covers all three.
 *
 * The heading is the exposure. On two of the screens it holds a client name or a product
 * name, and neither is under anyone here's control — so the long unbroken case is a
 * fixture rather than an edge case. The tender list is the eyebrow-less shape: its own
 * heading is a static translated string, which makes it the least likely of the three to
 * overflow, but it is one of the three hand-check 1 of #48 walked and a guard that
 * skipped it would leave the config's docblock claiming coverage it did not have.
 *
 * Both locales, because the buttons are translated and #56 is explicit that *"the labels
 * are translated, so English is not the worst case"*. A Han glyph is about twice the
 * width of a Latin letter, so a shorter Chinese string is not automatically narrower.
 */

const locales = [
  ["en", en],
  ["zh-Hans", zhHans],
] as const;

/** The three headers, with whichever locale's real button labels on them. */
function cases(m: typeof en) {
  return {
    "the Tender detail, two buttons": {
      eyebrow: "TR-2026-0142",
      heading: "Bangkok Metropolitan Administration",
      detail: "Medical consumables, Q3 2026",
      actions: [m.tenders.backToList, m.tenders.edit],
    },
    "item sourcing, one button and a long eyebrow": {
      eyebrow: "TR-2026-0142 · Bangkok Metropolitan Administration",
      heading: "Nitrile examination glove, powder-free, size M",
      detail: "40,000 piece",
      actions: [m.quotes.backToTender],
    },
    "the tender list, which has no reference of its own": {
      eyebrow: undefined,
      heading: m.tenders.title,
      detail: m.tenders.description,
      actions: [m.tenders.record],
    },
    "a client and a product with nowhere to wrap": {
      eyebrow: "TR20260142MOPHDMSCENTRALPROCUREMENT0098",
      heading: "ChulalongkornMemorialHospitalProcurementDepartment",
      detail: "NitrileExaminationGlovesPowderFreeSizeMediumNonSterile",
      actions: [m.tenders.backToList, m.tenders.edit],
    },
  };
}

describe(`a screen header at ${phone.width}×${phone.height}`, () => {
  it.each(
    locales.flatMap(([locale, m]) =>
      Object.entries(cases(m)).map(
        ([name, fixture]) => [`${name}, in ${locale}`, fixture] as const,
      ),
    ),
  )("does not push the page sideways: %s", (_case, fixture) => {
    render(
      // The page's own wrapper, so the header is measured inside the padding it really
      // has rather than edge to edge.
      <div className="flex flex-1 flex-col gap-8 p-6">
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-8">
          <ScreenHeader
            eyebrow={fixture.eyebrow}
            heading={fixture.heading}
            actions={fixture.actions.map((label) => (
              <Button key={label} variant="outline" className="h-11">
                {label}
              </Button>
            ))}
          >
            <p className="text-muted-foreground text-sm break-words">{fixture.detail}</p>
          </ScreenHeader>
        </main>
      </div>,
    );

    expectNoSidewaysScroll();
  });
});
