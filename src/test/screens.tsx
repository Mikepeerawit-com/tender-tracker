import { NextIntlClientProvider } from "next-intl";

import "@/app/globals.css";

import { AppHeader } from "@/components/app-header";
import { EditQuoteForm } from "@/components/quotes/edit-quote-form";
import { ItemBrief } from "@/components/quotes/item-brief";
import { QuoteList } from "@/components/quotes/quote-list";
import { AssigneeControls } from "@/components/tenders/assignee-controls";
import { OutstandingBand } from "@/components/tenders/outstanding-band";
import { TenderFacts } from "@/components/tenders/tender-facts";
import { TenderGroup } from "@/components/tenders/tender-group";
import { QuoteForm } from "@/components/quotes/quote-form";
import { Button } from "@/components/ui/button";
import { ScreenError } from "@/components/ui/screen-error";
import { ScreenHeader } from "@/components/ui/screen-header";
import { ScreenSkeleton } from "@/components/ui/screen-skeleton";
import type { Member } from "@/lib/org/members";
import { blankQuote, quoteAsSubmitted } from "@/lib/quotes/quote-form";
import type { Quote } from "@/lib/quotes/quotes";
import type { Tender } from "@/lib/tenders/tenders";
import type { WorklistRow } from "@/lib/tenders/worklist";
import en from "@/messages/en.json";
import zhHans from "@/messages/zh-Hans.json";

/**
 * **Every screen, composed the way its page composes it** — the fixtures, and nothing
 * that measures or captures them.
 *
 * This began at the top of `screens.layout.test.tsx` and moved here when #78 gave it a
 * second reader. Two things now render these: the layout guard, which measures them and
 * asserts, and the contact sheet, which photographs them for somebody to look at. They
 * have to be the *same* screens or the sheet stops being evidence about the thing under
 * test — so there is one copy, and adding a screen here adds it to both.
 *
 * Each entry is a screen as the router really assembles it: the page's own `AppHeader` —
 * carrying the location shape that screen really draws, since #73 — then the page's body
 * underneath, inside the page's own wrapper div. An org admin is used throughout, because
 * that is the fullest menu and the worst case for the bar.
 *
 * `OutcomePanel` is the one part of the detail screen missing: it is an `async` Server
 * Component that awaits `tenderVerdict`, so it cannot be rendered in a browser at all.
 * Making it drawable here means giving it the same sync seam as the rest, which is a
 * change to that component rather than to this file.
 *
 * The mocks these components need are **not** here. `vi.mock` is hoisted per file and
 * cannot be shared, so each renderer declares its own block — which is why the two look
 * duplicated and are not.
 */

/** Both locales, in the order everything downstream lists them. */
export const locales = [
  ["en", en],
  ["zh-Hans", zhHans],
] as const;

export type Locale = (typeof locales)[number][0];
export type Messages = typeof en;

/**
 * Each screen, as its page composes it under the `(app)` layout.
 *
 * A function, not a const: the fixtures it reads are declared at the bottom of the file,
 * the way this repo's other layout suites arrange them, and a top-level object would
 * touch them before they exist.
 */
export function screens(m: Messages) {
  return {
    "the tender list": (
      <Body width="max-w-3xl" bar={<AppHeader isOrgAdmin />}>
        <ScreenHeader
          heading={m.tenders.title}
          actions={<Button className="h-11">{m.tenders.record}</Button>}
        >
          <p className="text-muted-foreground text-sm break-words">
            {m.tenders.description}
          </p>
        </ScreenHeader>
        {/* The pinned alarm band and an ordinary Progress group, which are the two
            shapes the list has. The band is the wider of the two — it carries a hint
            paragraph and a count inside a bordered box — so measuring only the plain
            group would miss the case that actually pushes. */}
        <TenderGroup
          section={{ group: "submission_missed", tenders: [deadRow] }}
          timezone="Asia/Bangkok"
        />
        <TenderGroup
          section={{ group: "sourcing", tenders: [ordinaryRow, unbrokenRow] }}
          timezone="Asia/Bangkok"
        />
      </Body>
    ),
    "a tender": (
      <Body width="max-w-7xl" bar={<AppHeader isOrgAdmin location={tenderBar} />}>
        <ScreenHeader
          heading={tender.clientName}
          actions={
            <Button variant="outline" className="h-11">
              {m.tenders.edit}
            </Button>
          }
        >
          <p className="text-muted-foreground text-sm break-words">{tender.title}</p>
        </ScreenHeader>
        {/* Two Items with nothing to break in their names, which is the row this band
            has that can be any width — a product name is whatever the client called it. */}
        <OutstandingBand tenderId={tender.id} items={outstanding} />
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
      <Body width="max-w-3xl" bar={<AppHeader isOrgAdmin location={itemBar} />}>
        {/* The brief, with the client's pictures in it — the block #75 put above the
            form so an Assignee can check they are pricing the right thing. */}
        <ItemBrief
          productName="NitrileExaminationGlovesPowderFreeSizeMediumNonSterile"
          quantity={40000}
          unit="piece"
          description="Non-sterile, TFDA registration number to be quoted alongside every line."
          internalQuoteDeadline="2026-08-20"
        />
        <QuoteList
          tenderId={tender.id}
          tenderItemId="item-gloves"
          quotes={quotes}
          photos={new Map()}
          // The reader sourced these, so the row draws its edit and delete controls —
          // which is the crowded case, and the one worth measuring at 390px.
          callerId={quotes[0].sourcedByUserId}
          ownerUserId="user-somchai"
          selectedQuoteId={quotes[0].id}
        />
        <QuoteForm
          tenderId={tender.id}
          tenderItemId="item-gloves"
          defaults={blankQuote({ unit: "piece", today: "2026-08-12" })}
        />
      </Body>
    ),
    "correcting a quote": (
      <Body width="max-w-3xl" bar={<AppHeader isOrgAdmin location={itemBar} />}>
        <header className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs break-words">
            {`${tender.reference} · Nitrile examination glove, powder-free, size M`}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{m.quotes.editTitle}</h1>
        </header>
        <EditQuoteForm
          tenderId={tender.id}
          tenderItemId="item-gloves"
          quoteId={quotes[0].id}
          // A non-THB Quote, so the read-only currency cell is drawn carrying a real
          // currency rather than the reporting one it would default to.
          currency={quotes[0].currency}
          defaults={quoteAsSubmitted(quotes[0])}
        />
      </Body>
    ),
    // The two screens that stand in for the others, and are screens in their own right:
    // whoever taps a link on a phone sees the first of these before anything else, and
    // sees the second instead of a blank page when the fetch behind it fails (#57).
    // Neither is wrapped in `Body` — a route-level `loading.tsx` and `error.tsx` replace
    // the page, so each has to draw the page's own wrapper itself, and does.
    "the loading fallback": (
      <>
        <AppHeader isOrgAdmin={false} />
        <ScreenSkeleton />
      </>
    ),
    // A digest of the length Next really mints, since it is the one string on this screen
    // that nobody chose the width of.
    "a screen that threw": (
      <>
        <AppHeader isOrgAdmin={false} />
        <ScreenError digest="3990102495" retry={() => {}} />
      </>
    ),
  };
}

/**
 * A screen wrapped in the provider every one of them needs.
 *
 * Both renderers need exactly this and nothing more, so the wrapping lives here rather
 * than being retyped either side.
 */
export function Screen({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
      {children}
    </NextIntlClientProvider>
  );
}

/**
 * A whole `(app)` page: its own app bar, then the wrapper it draws its body inside.
 *
 * The bar is a prop rather than something this renders itself, because since #73 each
 * page draws the bar shape that names *where it is* — the list gets the wordmark, a
 * Tender and the sourcing screen get the record form with a reference and a client name
 * in it. Composing the wrong one here would measure a screen the router never assembles.
 */
export function Body({
  width,
  bar,
  children,
}: {
  width: string;
  bar: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      {bar}
      <div className="flex flex-1 flex-col gap-8 p-6">
        <main className={`mx-auto flex w-full flex-col gap-8 ${width}`}>{children}</main>
      </div>
    </>
  );
}

/** The two record bars, carrying the unbroken strings a client really supplies. */
const tenderBar = {
  kind: "record",
  backHref: "/tenders",
  reference: "TR-2026-0142",
  detail: "ChulalongkornMemorialHospitalProcurementDepartment",
} as const;

export const itemBar = {
  kind: "record",
  backHref: "/tenders/8f14e45f",
  reference: "TR-2026-0142",
  detail:
    "ChulalongkornMemorialHospitalProcurementDepartment · Nitrile examination glove, powder-free, size M",
} as const;

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
  status: { kind: "due", tone: "signal", deadline: "internal_quote", days: 1 },
  notYetSourced: 0,
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

/** The pinned group's one row, carrying the longest sentence the list ever says. */
const deadRow: WorklistRow = {
  ...rowBase,
  id: "2b7a1c05-6e39-4f21-8a4d-9c0e3f5b7d12",
  reference: "TR20260142MOPHDMSCENTRALPROCUREMENT0098",
  clientName: "ChulalongkornMemorialHospitalProcurementDepartment",
  title: "NitrileExaminationGlovesPowderFreeSizeMediumNonSterile",
  ownerName: "Somchai Prasertkul",
  progress: "new",
  dueDeadlines: [],
  status: { kind: "submission_missed", tone: "alarm", days: 128 },
};

const outstanding = [
  { id: "item-gloves", productName: "Nitrile examination glove, powder-free, size M" },
  {
    id: "item-masks",
    productName: "SurgicalFaceMaskThreePlyTypeIIRWithEarloopsNonSterile",
  },
];

export const tender: Tender = {
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
