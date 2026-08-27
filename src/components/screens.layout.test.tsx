import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, it, vi } from "vitest";

import "@/app/globals.css";

import { AppHeader } from "@/components/app-header";
import { QuoteForm } from "@/components/quotes/quote-form";
import { QuoteList } from "@/components/quotes/quote-list";
import { AssigneeControls } from "@/components/tenders/assignee-controls";
import { TenderFacts } from "@/components/tenders/tender-facts";
import { TenderRow } from "@/components/tenders/tender-row";
import { Button } from "@/components/ui/button";
import { ScreenHeader } from "@/components/ui/screen-header";
import type { Member } from "@/lib/org/members";
import { blankQuote } from "@/lib/quotes/quote-form";
import type { Quote } from "@/lib/quotes/quotes";
import type { Tender } from "@/lib/tenders/tenders";
import type { WorklistRow } from "@/lib/tenders/worklist";
import en from "@/messages/en.json";
import zhHans from "@/messages/zh-Hans.json";
import { expectNoSidewaysScroll, phone } from "@/test/layout";

/**
 * **Whole screens, header and body together** — the shape hand-check 1 of #48 actually
 * reported.
 *
 * The per-component suites each measure one thing in isolation, and that is exactly how
 * #56 got through: `working-sheet.layout.test.tsx` rendered the sheet on a bare page and
 * passed, while the real screen carried the app shell's header above it and overflowed.
 * A guard that never composes the two cannot see the bug the user saw.
 *
 * So each case here is a screen as the router really assembles it: `AppHeader` from the
 * `(app)` layout, then the page's own body underneath, inside the page's own wrapper
 * div. An org admin is used throughout, because that is the six-button bar and the worst
 * case for the header.
 *
 * Both locales, for the reason #56 gives — *"the labels are translated, so English is not
 * the worst case"*. A Han glyph is about twice the width of a Latin letter, so a shorter
 * Chinese string is not automatically a narrower button.
 *
 * `OutcomePanel` is the one part of the detail screen missing here: it is an `async`
 * Server Component that awaits `tenderVerdict`, so it cannot be rendered in a browser
 * test at all. Making it measurable means giving it the same sync seam as the rest, which
 * is a change to that component rather than to this file.
 */

vi.mock("@/app/actions/auth", () => ({ signOutAction: async () => ({}) }));
vi.mock("@/app/actions/locale", () => ({ switchLocale: async () => ({}) }));
vi.mock("@/app/actions/tenders", () => ({
  addAssigneeAction: async () => ({}),
  removeAssigneeAction: async () => ({}),
}));
vi.mock("@/app/actions/quotes", () => ({
  createQuoteAction: async () => ({}),
  deleteQuoteAction: async () => ({}),
}));
// `QuoteList` draws each Quote's photo controls, which reach for these.
vi.mock("@/app/actions/quote-photos", () => ({
  recordQuotePhotosAction: async () => ({}),
  removeQuotePhotoAction: async () => ({}),
  signQuotePhotoUploadsAction: async () => ({}),
}));

const locales = [
  ["en", en],
  ["zh-Hans", zhHans],
] as const;

/**
 * Each screen, as its page composes it under the `(app)` layout.
 *
 * A function, not a const: the fixtures it reads are declared at the bottom of the file,
 * the way this repo's other layout suites arrange them, and a top-level object would
 * touch them before they exist.
 */
function screens(m: typeof en) {
  return {
    "the tender list": (
      <Body width="max-w-3xl">
        <ScreenHeader
          heading={m.tenders.title}
          actions={<Button className="h-11">{m.tenders.record}</Button>}
        >
          <p className="text-muted-foreground text-sm break-words">
            {m.tenders.description}
          </p>
        </ScreenHeader>
        <ul className="flex flex-col gap-3">
          {[ordinaryRow, unbrokenRow].map((row) => (
            <li key={row.id}>
              <TenderRow block="coming_up" tender={row} />
            </li>
          ))}
        </ul>
      </Body>
    ),
    "a tender": (
      <Body width="max-w-7xl">
        <ScreenHeader
          eyebrow={tender.reference}
          heading={tender.clientName}
          actions={
            <>
              <Button variant="ghost" className="h-11">
                {m.tenders.backToList}
              </Button>
              <Button variant="outline" className="h-11">
                {m.tenders.edit}
              </Button>
            </>
          }
        >
          <p className="text-muted-foreground text-sm break-words">{tender.title}</p>
        </ScreenHeader>
        <TenderFacts tender={tender} />
        <AssigneeControls
          tenderId={tender.id}
          assignees={tender.assignees}
          members={members}
          callerId="user-somchai"
          isOwner
        />
      </Body>
    ),
    "sourcing an item": (
      <Body width="max-w-3xl">
        <ScreenHeader
          eyebrow={`${tender.reference} · ${tender.clientName}`}
          heading="Nitrile examination glove, powder-free, size M"
          actions={
            <Button variant="outline" className="h-11">
              {m.quotes.backToTender}
            </Button>
          }
        >
          <p className="text-muted-foreground text-sm break-words">40,000 piece</p>
        </ScreenHeader>
        <QuoteList tenderId={tender.id} quotes={quotes} photos={new Map()} />
        <QuoteForm
          tenderId={tender.id}
          tenderItemId="item-gloves"
          defaults={blankQuote({ unit: "piece", today: "2026-08-12" })}
        />
      </Body>
    ),
  };
}

describe(`a whole screen at ${phone.width}×${phone.height}`, () => {
  it.each(
    locales.flatMap(([locale, messages]) =>
      Object.entries(screens(messages)).map(
        ([name, body]) => [`${name}, in ${locale}`, locale, messages, body] as const,
      ),
    ),
  )("does not scroll sideways: %s", (_case, locale, messages, body) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
        <AppHeader name="Somchai Prasertkul" isOrgAdmin />
        {body}
      </NextIntlClientProvider>,
    );

    expectNoSidewaysScroll();
  });
});

/** The wrapper every `(app)` page draws its body inside. */
function Body({ width, children }: { width: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-8 p-6">
      <main className={`mx-auto flex w-full flex-col gap-8 ${width}`}>{children}</main>
    </div>
  );
}

/* ============================ fixtures ============================ */

const members: Member[] = [
  { id: "user-somchai", name: "Somchai Prasertkul" },
  { id: "user-nok", name: "Nok Wattanapong" },
  { id: "user-wei", name: "Wei Zhang" },
];

const rowBase = {
  id: "",
  dateReceived: "2026-08-01",
  internalQuoteDeadline: "2026-08-20",
  clientSubmissionDeadline: "2026-08-28",
  expectedDecisionDate: null,
  ownerUserId: "user-somchai",
  notes: null,
  submittedAt: null,
  itemCount: 12,
  progress: "sourcing",
  dueDeadlines: ["internal_quote"],
  reference: "",
  clientName: "",
  title: "",
  ownerName: "",
} satisfies WorklistRow;

const ordinaryRow: WorklistRow = {
  ...rowBase,
  id: "8f14e45f-ceea-4d67-b4a7-4c5e2f6a1b90",
  reference: "TR-2026-0142",
  clientName: "Bangkok Metropolitan Administration",
  title: "Medical consumables, Q3 2026",
  ownerName: "Somchai P.",
};

/** Nothing invented: Thai procurement references run this long without a break. */
const unbrokenRow: WorklistRow = {
  ...rowBase,
  id: "1c9d3b77-0a52-4c1e-9f88-2b6d4e7a5c31",
  reference: "TR20260142MOPHDMSCENTRALPROCUREMENT0098",
  clientName: "ChulalongkornMemorialHospitalProcurementDepartment",
  title: "NitrileExaminationGlovesPowderFreeSizeMediumNonSterile",
  ownerName: "Somchai Prasertkul",
};

const tender: Tender = {
  id: "8f14e45f-ceea-4d67-b4a7-4c5e2f6a1b90",
  reference: "TR-2026-0142",
  clientName: "ChulalongkornMemorialHospitalProcurementDepartment",
  title: "Medical consumables and disposables, fiscal year 2026 Q3",
  dateReceived: "2026-08-01",
  internalQuoteDeadline: "2026-08-20",
  clientSubmissionDeadline: "2026-08-28",
  expectedDecisionDate: null,
  ownerUserId: "user-somchai",
  ownerName: "Somchai Prasertkul",
  submittedAt: null,
  // Free text somebody typed, which is the fact on this grid that can be any length.
  notes:
    "Client asked for the TFDA registration numbers alongside every line, and confirmation that gloves are non-sterile.",
  items: [],
  assignees: [{ id: "user-nok", name: "Nok Wattanapong" }],
};

const quotes: Quote[] = [
  {
    id: "q1a",
    tenderItemId: "item-gloves",
    supplierName: "Shanghai Kindly Medical Instruments Co., Ltd.",
    unitPrice: 0.42,
    currency: "CNY",
    quotedUnit: "piece",
    unitPriceThb: 2.124,
    fxRateMid: 4.96,
    fxRateApplied: 5.0592,
    fxRateAsOf: "2026-08-11",
    fxRateIsStale: false,
    leadTimeDays: 30,
    matchType: "exact",
    alternativeProductName: null,
    detailNotes: null,
    quotedAt: "2026-08-12",
    sourcedByUserId: "user-somchai",
    sourcedByName: "Somchai Prasertkul",
  },
];
