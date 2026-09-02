import { NextIntlClientProvider, useTranslations } from "next-intl";

import "@/app/globals.css";

import { AppHeader, type AppLocation } from "@/components/app-header";
import { BottomNav } from "@/components/app-nav";
import { ImageCountBadge } from "@/components/images/image-count-badge";
import { EditQuoteForm } from "@/components/quotes/edit-quote-form";
import { ItemBrief } from "@/components/quotes/item-brief";
import { NoSupplierFoundForm } from "@/components/quotes/no-supplier-found-form";
import { QuoteList } from "@/components/quotes/quote-list";
import { AssigneeControls } from "@/components/tenders/assignee-controls";
import { MyWorkList } from "@/components/tenders/my-work-list";
import { OutstandingBand } from "@/components/tenders/outstanding-band";
import { SourcingList } from "@/components/tenders/sourcing-list";
import { TenderFacts } from "@/components/tenders/tender-facts";
import { TenderGroup } from "@/components/tenders/tender-group";
import { QuoteForm } from "@/components/quotes/quote-form";
import { Button } from "@/components/ui/button";
import { ScreenBody, type ScreenWidth } from "@/components/ui/screen-body";
import { ScreenError } from "@/components/ui/screen-error";
import { ScreenHeader } from "@/components/ui/screen-header";
import { ScreenSkeleton } from "@/components/ui/screen-skeleton";
import type { QuotePhoto } from "@/lib/images/quote-photos";
import type { ReferenceImage } from "@/lib/images/reference-images";
import type { Member } from "@/lib/org/members";
import { blankQuote, quoteAsSubmitted } from "@/lib/quotes/quote-form";
import type { NoSupplierFound, Quote } from "@/lib/quotes/quotes";
import type { MyWorkRow } from "@/lib/tenders/my-work";
import type { OutstandingItem, SourcingItem } from "@/lib/tenders/tender-screen";
import type { Tender, TenderItem } from "@/lib/tenders/tenders";
import { yourQuotes } from "@/lib/tenders/viewer";
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
 * underneath, inside `ScreenBody` — the wrapper every page draws it in — and the bottom
 * bar `(app)/layout.tsx` draws beneath every one of them since #96. An org admin is used
 * throughout, because that is the fullest menu and the worst case for the bar.
 *
 * The bottom bar is **not** in any of them, and that is the point: it belongs to
 * `(app)/layout.tsx` rather than to a page, so {@link Screen} draws it once for all of
 * them — including the two that replace a page. A `loading.tsx` or an `error.tsx` keeps
 * it, and a fallback that took the way out with it would strand somebody on a screen that
 * could not load.
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
    // The screen an Assignee actually opens (ADR-0021): their own Items, each linking
    // straight to the quote form. Composed at 390px, which is the width it is designed
    // for rather than one it merely has to survive.
    "my work": (
      <Body width="max-w-3xl">
        <ScreenHeader heading={m.myWork.title}>
          <p className="text-muted-foreground text-sm break-words">
            {m.myWork.description}
          </p>
        </ScreenHeader>
        <MyWorkList items={myWorkRows} />
      </Body>
    ),
    // The same screen with the work done, which is a screen in its own right rather than
    // the one above with rows removed: it draws one sentence and no list at all, and the
    // list reaching zero is the requirement this destination is built around.
    "my work, finished": (
      <Body width="max-w-3xl">
        <ScreenHeader heading={m.myWork.title}>
          <p className="text-muted-foreground text-sm break-words">
            {m.myWork.description}
          </p>
        </ScreenHeader>
        <MyWorkList items={[]} />
      </Body>
    ),
    "the tender list": (
      <Body width="max-w-7xl">
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
      <Body width="max-w-7xl" location={tenderBar}>
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
        {/* The two Items the Owner has neither priced nor given up on, both named with
            nothing in them to break at — which is the row this band has that can be any
            width, because a product name is whatever the client called it. */}
        <OutstandingBand tenderId={tender.id} items={yourOutstanding(tender.ownerUserId)} />
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
    // The same route, drawn for somebody who does not own the Tender (ADR-0020, #92).
    // A screen in its own right rather than a variant of the one above: it has the sheet
    // and the Outcome panel taken out and a list of your own sourcing put in, and that
    // list is markup no other screen draws.
    "a tender somebody else owns": (
      <Body width="max-w-7xl" location={tenderBar}>
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
        {/* The one Item this reader still owes, which is the whole of what the band
            says to somebody who has already priced two of the three. */}
        <OutstandingBand tenderId={tender.id} items={yourOutstanding("user-nok")} />
        <TenderFacts tender={tender} />
        <SourcingList
          tenderId={tender.id}
          items={yourSourcing("user-nok")}
          photos={quotePhotos}
          referenceImages={referenceImages}
        />
        <AssigneeControls
          tenderId={tender.id}
          assignees={tender.assignees}
          members={members}
          callerId="user-nok"
          isOwner={false}
        />
      </Body>
    ),
    "sourcing an item": (
      <Body width="max-w-3xl" location={itemBar}>
        {/* The brief, with the client's pictures in it — the block #75 put above the
            form so an Assignee can check they are pricing the right thing. */}
        <ItemBrief
          productName={gloves.productName}
          quantity={gloves.quantity}
          unit={gloves.unit}
          description={gloves.description}
          internalQuoteDeadline={tender.internalQuoteDeadline}
        />
        <QuoteList
          tenderId={tender.id}
          tenderItemId={gloves.id}
          quotes={gloveQuotes}
          photos={new Map()}
          // The Owner is reading, and a Quote is correctable by whoever sourced it or by
          // them (`mayCorrectQuote`) — so every row draws its edit and delete controls,
          // which is the crowded case and the one worth measuring at 390px.
          callerId={tender.ownerUserId}
          ownerUserId={tender.ownerUserId}
          selectedQuoteId={selectedGloveQuoteId}
          // Every Quote on the Item, both Assignees' — the Owner's view, and the widest
          // this list gets. What a non-Owner reads is the screen below rather than this
          // one with rows removed: it counts the list differently and carries a form this
          // one does not (#94).
          yourQuotesOnly={false}
        />
        <QuoteForm
          tenderId={tender.id}
          tenderItemId={gloves.id}
          defaults={blankQuote({ unit: gloves.unit, today: "2026-08-12" })}
        />
      </Body>
    ),
    // The same route, drawn for an Assignee who does not own the Tender (ADR-0020, #93):
    // their own Quotes and nobody else's, counted in words that say whose they are. This
    // is the screen the reduction is really for — an Assignee opens it several times per
    // Item off a run of supplier calls, and it is the one place they type anything — so
    // it is composed whole here, down to the form and the refusal box the Owner's copy
    // above leaves out.
    "sourcing an item on a tender somebody else owns": (
      <Body width="max-w-3xl" location={itemBar}>
        <ItemBrief
          productName={gloves.productName}
          quantity={gloves.quantity}
          unit={gloves.unit}
          description={gloves.description}
          internalQuoteDeadline={tender.internalQuoteDeadline}
          // What the client sent, narrowed to this Item as `loadItemSourcingScreen`
          // narrows it — an Assignee shows their supplier the picture of the thing they
          // are being asked to price, and a picture of another Item is not it. The badge
          // draws nothing at all when there are none, so no guard is written here.
          images={
            <ReferenceImages label={gloves.productName} images={imagesOn(gloves.id)} />
          }
        />

        <section className="flex flex-col gap-4">
          {/* "2 quotes from you", never "2 quotes recorded": the heading counts this
              reader's own work rather than making a claim about the Item that ADR-0020
              has just decided they do not get told. */}
          <YourQuotesHeading count={yourGloveQuotes.length} />
          <QuoteList
            tenderId={tender.id}
            tenderItemId={gloves.id}
            quotes={yourGloveQuotes}
            photos={quotePhotos}
            callerId="user-nok"
            ownerUserId={tender.ownerUserId}
            // The Owner picked somebody else's Quote, so the loader drops the id rather
            // than pointing it at a row this reader was never handed.
            selectedQuoteId={null}
            yourQuotesOnly
          />
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-medium">{m.quotes.add}</h2>
            <p className="text-muted-foreground text-xs">{m.quotes.addHint}</p>
          </div>
          <QuoteForm
            tenderId={tender.id}
            tenderItemId={gloves.id}
            defaults={blankQuote({ unit: gloves.unit, today: "2026-08-12" })}
          />
        </section>

        {/* The third state, in the dashed box the page gives it: an Assignee saying
            they could not source this at all. It draws the form rather than a record,
            because nobody has given up on the gloves — this reader has not, and the two
            colleagues who could have have both priced them instead. A colleague's note,
            when there is one, is shown as fact and is measured on the Tender detail. */}
        <section className="border-border rounded-lg border border-dashed p-4">
          <NoSupplierFoundForm
            tenderId={tender.id}
            tenderItemId={gloves.id}
            mine={null}
            others={refusalsOn(gloves.id).filter(
              (refusal) => refusal.userId !== "user-nok",
            )}
          />
        </section>
      </Body>
    ),
    "correcting a quote": (
      <Body width="max-w-3xl" location={itemBar}>
        <header className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs break-words">
            {`${tender.reference} · Nitrile examination glove, powder-free, size M`}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{m.quotes.editTitle}</h1>
        </header>
        <EditQuoteForm
          tenderId={tender.id}
          tenderItemId={gloves.id}
          quoteId={gloveQuotes[0].id}
          // A non-THB Quote, so the read-only currency cell is drawn carrying a real
          // currency rather than the reporting one it would default to.
          currency={gloveQuotes[0].currency}
          defaults={quoteAsSubmitted(gloveQuotes[0])}
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
 * A screen wrapped in the provider every one of them needs, inside the box the real
 * `body` gives it.
 *
 * Both renderers need exactly this and nothing more, so the wrapping lives here rather
 * than being retyped either side.
 *
 * **The full-height flex column is `body`, and the bottom bar is what it is here for.**
 * `app/layout.tsx` gives `body` a full-height flex column and every screen's wrapper takes
 * `flex-1` inside it; `min-h-dvh` is that height stated against the viewport, since this
 * div has no `html` above it to inherit one from. Without the column the `flex-1` measures
 * nothing and the bar lands directly under the last row of a short screen instead of at
 * the foot of the phone, where a thumb finds it — and the bar is drawn here, once, exactly
 * as `(app)/layout.tsx` draws it beneath every page.
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
      <div className="flex min-h-dvh flex-col">
        {children}
        <BottomNav />
      </div>
    </NextIntlClientProvider>
  );
}

/**
 * A whole `(app)` page: its own app bar, then the wrapper it draws its body inside.
 *
 * **`Screen`'s two lines, without the session read.** It drew its own copy of the
 * wrapper's markup until #97, which was a copy that could drift from the component every
 * page really uses — and the thing #97 changed is exactly that markup, so a suite
 * measuring the copy would have measured nothing. `ScreenBody` and `AppHeader` are both
 * sync and reach for nothing, so this composes them; only `currentUser` is out of a
 * browser's reach, and `isOrgAdmin` stands in for it.
 *
 * `location` is a prop rather than something chosen here, because since #73 each page
 * draws the bar shape that names *where it is* — the list gets the wordmark, a Tender and
 * the sourcing screen get the record form with a reference and a client name in it.
 * Composing the wrong one would measure a screen the router never assembles.
 *
 * **`width` is one value and reaches both halves**, exactly as `Screen` hands it to both:
 * a fixture that told the bar one number and the body another could pass an alignment
 * check that the app fails.
 */
export function Body({
  width,
  location,
  children,
}: {
  width?: ScreenWidth;
  location?: AppLocation;
  children: React.ReactNode;
}) {
  return (
    <>
      {/* An org admin, always: it is the widest the bar ever is — the menu behind it
          carries People and Group Robot as well as Sign out — and the bar's own suite is
          where the ordinary member's is measured. */}
      <AppHeader isOrgAdmin location={location} width={width} />
      <ScreenBody width={width}>{children}</ScreenBody>
    </>
  );
}

/**
 * The heading the sourcing screen draws over one reader's own Quotes: "2 quotes from
 * you", never "2 quotes recorded".
 *
 * A component rather than a string read off `m`, because it is a counted sentence —
 * `{count, plural, …}` — and the raw message pasted into the markup would draw its ICU
 * source rather than the words a reader sees, which is a different screen to measure and
 * a worse one to photograph. {@link ReferenceImages} is here for the same reason.
 */
function YourQuotesHeading({ count }: { count: number }) {
  const t = useTranslations("quotes");

  return <h2 className="text-sm font-medium">{t("yours.recorded", { count })}</h2>;
}

/** The client's own pictures for one Item, as the sourcing page hands them to the brief. */
function ReferenceImages({ label, images }: { label: string; images: ReferenceImage[] }) {
  const t = useTranslations("tenders.referenceImages");

  return (
    <ImageCountBadge
      openLabel={t("openCount", { label, count: images.length })}
      images={images}
    />
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
  // Not on this Tender, so the enrol-yourself picker has somebody left to name.
  { id: "user-ploy", name: "Ploy Sirikanya" },
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

/**
 * The Tender's Items — several of them, because a Tender with one on it is not the case
 * the Assignee's reduced screens are for (#94).
 *
 * Everything below that is about an Item is derived from these rather than written out
 * again beside them: a `SourcingItem` is one of these carrying one reader's own work, and
 * the outstanding band names two of them. Held once, they cannot come to disagree about
 * what the client asked for.
 */
const items: TenderItem[] = [
  {
    id: "item-gloves",
    productName: "NitrileExaminationGlovesPowderFreeSizeMediumNonSterile",
    description:
      "Non-sterile, TFDA registration number to be quoted alongside every line.",
    quantity: 40000,
    unit: "piece",
    outcome: null,
    outcomeAt: null,
  },
  {
    id: "item-masks",
    productName: "SurgicalFaceMaskThreePlyTypeIIRWithEarloopsNonSterile",
    description: null,
    quantity: 2000,
    unit: "box of 50",
    outcome: null,
    outcomeAt: null,
  },
  {
    id: "item-syringes",
    productName: "Disposable syringe, 5ml, luer lock",
    description: null,
    quantity: 12000,
    unit: "piece",
    outcome: null,
    outcomeAt: null,
  },
];

/** The Item both sourcing screens are about, named rather than indexed at five sites. */
const gloves = items[0];

/**
 * My work's rows: three Items one Assignee has not answered for, at the three urgencies
 * the row can carry.
 *
 * Built from `items` rather than written out again, so the product names here and the
 * ones the sourcing screens draw cannot come to disagree. Two of the three are the
 * unbroken runs a client really supplies — a row that has to break a 53-character product
 * name *and* a reference with no space in it is the case that pushes this screen sideways
 * at 390px, and it is the ordinary case rather than the invented one.
 *
 * The alarm row is a deadline already gone by, which is the reading `sourcingDeadlineStatus`
 * gives an Item its own Assignee is late on. Its lamp and its sentence are the loudest
 * thing here and they are drawn together, so a screen that lost one would be measured
 * with the other still in it.
 */
const myWorkRows: MyWorkRow[] = [
  {
    itemId: items[0].id,
    tenderId: "8f14e45f-ceea-4d67-b4a7-4c5e2f6a1b90",
    productName: items[0].productName,
    clientName: "ChulalongkornMemorialHospitalProcurementDepartment",
    reference: "TR20260142MOPHDMSCENTRALPROCUREMENT0098",
    internalQuoteDeadline: "2026-08-07",
    status: { tone: "alarm", days: -5 },
  },
  {
    itemId: items[1].id,
    tenderId: "8f14e45f-ceea-4d67-b4a7-4c5e2f6a1b90",
    productName: items[1].productName,
    clientName: "Bangkok Metropolitan Administration",
    reference: "TR-2026-0142",
    internalQuoteDeadline: "2026-08-13",
    status: { tone: "signal", days: 1 },
  },
  {
    itemId: items[2].id,
    tenderId: "1c9d3b77-0a52-4c1e-9f88-2b6d4e7a5c31",
    productName: items[2].productName,
    clientName: "Siriraj Hospital, Faculty of Medicine",
    reference: "TR-2026-0151",
    internalQuoteDeadline: "2026-09-30",
    status: { tone: "calm", days: 49 },
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
  items,
  // Three, and the Owner is one of them. Two non-Owner Assignees are what make the
  // reduction visible at all — ADR-0020 hides a colleague's price, and a Tender with one
  // Assignee on it has no colleague to hide — and the Owner is here because only an
  // Assignee may enter a Quote (`CONTEXT.md`, **Assignee**). Without that, the Owner's
  // sourcing screen below draws a form the page would have refused them, and precedence
  // is settled: a user who is both sees everything.
  assignees: [
    { id: "user-somchai", name: "Somchai Prasertkul" },
    { id: "user-nok", name: "Nok Wattanapong" },
    { id: "user-wei", name: "Wei Zhang" },
  ],
};

/**
 * Every Quote on the Tender, from both of its Assignees — the Item's whole record, which
 * is what the Owner is handed and what the two reduced screens are a subset of (ADR-0020).
 *
 * Several on each Item, and two people's on the Item both sourcing screens draw, because
 * that is the only arrangement in which the reduction is a visible thing at all: the
 * Owner's copy of the gloves screen lists three, and an Assignee's lists the two that are
 * theirs. A fixture with one Quote on it would photograph the same screen twice.
 *
 * Every rate is frozen into the row as a real one is, and the THB figure is
 * `unitPrice × fxRateApplied` — the product the database computes, so that nothing here
 * is a number the app could not have produced.
 */
const everyQuote: Quote[] = [
  {
    id: "q1a",
    tenderItemId: "item-gloves",
    supplierName: "Shanghai Kindly Medical Instruments Co., Ltd.",
    unitPrice: 0.42,
    currency: "CNY",
    quotedUnit: "piece",
    unitPriceThb: 2.124864,
    fxRateMid: 4.96,
    fxRateApplied: 5.0592,
    fxRateAsOf: "2026-08-11",
    fxRateIsStale: false,
    leadTimeDays: 30,
    matchType: "exact",
    alternativeProductName: null,
    detailNotes: null,
    quotedAt: "2026-08-12",
    sourcedByUserId: "user-nok",
    sourcedByName: "Nok Wattanapong",
  },
  /* An alternative, which is the widest row either quote list has: it carries a second
     product name under the supplier's — what the supplier actually priced, in their
     words, and therefore a string nobody here chose the length of. */
  {
    id: "q1b",
    tenderItemId: "item-gloves",
    supplierName: "Top Glove (Thailand) Co., Ltd.",
    unitPrice: 2.35,
    currency: "THB",
    quotedUnit: "piece",
    // A THB Quote stores both rates as 1 and is not converted at all.
    unitPriceThb: 2.35,
    fxRateMid: 1,
    fxRateApplied: 1,
    fxRateAsOf: "2026-08-13",
    fxRateIsStale: false,
    leadTimeDays: 21,
    matchType: "alternative",
    alternativeProductName:
      "NitrileExaminationGlovePowderFreeSizeMediumBlueTFDARegistered",
    detailNotes: null,
    quotedAt: "2026-08-13",
    sourcedByUserId: "user-nok",
    sourcedByName: "Nok Wattanapong",
  },
  /* The other Assignee's, on the same Item — the row the Owner reads and the reduced
     screen never receives. It is here to be subtracted. */
  {
    id: "q1c",
    tenderItemId: "item-gloves",
    supplierName: "GuangzhouImproveMedicalInstrumentsCoLtd",
    unitPrice: 0.062,
    currency: "USD",
    quotedUnit: "piece",
    unitPriceThb: 2.074272,
    fxRateMid: 32.8,
    fxRateApplied: 33.456,
    fxRateAsOf: "2026-08-10",
    fxRateIsStale: false,
    leadTimeDays: 45,
    matchType: "exact",
    alternativeProductName: null,
    detailNotes: null,
    quotedAt: "2026-08-11",
    sourcedByUserId: "user-wei",
    sourcedByName: "Wei Zhang",
  },
  {
    id: "q2a",
    tenderItemId: "item-masks",
    supplierName: "AnhuiZhongkeMedicalDevicesManufacturingCoLtd",
    unitPrice: 62.5,
    currency: "CNY",
    quotedUnit: "box of 50",
    unitPriceThb: 316.2,
    fxRateMid: 4.96,
    fxRateApplied: 5.0592,
    fxRateAsOf: "2026-08-11",
    fxRateIsStale: false,
    leadTimeDays: 25,
    matchType: "exact",
    alternativeProductName: null,
    detailNotes: null,
    quotedAt: "2026-08-12",
    sourcedByUserId: "user-wei",
    sourcedByName: "Wei Zhang",
  },
  {
    id: "q2b",
    tenderItemId: "item-masks",
    supplierName: "Bangkok Safety Supplies Co., Ltd.",
    unitPrice: 340,
    currency: "THB",
    quotedUnit: "box of 50",
    unitPriceThb: 340,
    fxRateMid: 1,
    fxRateApplied: 1,
    fxRateAsOf: "2026-08-14",
    fxRateIsStale: false,
    leadTimeDays: 7,
    matchType: "exact",
    alternativeProductName: null,
    detailNotes: null,
    quotedAt: "2026-08-14",
    sourcedByUserId: "user-wei",
    sourcedByName: "Wei Zhang",
  },
  {
    id: "q3a",
    tenderItemId: "item-syringes",
    supplierName: "Zhejiang Kangfu Medical Devices Co., Ltd.",
    unitPrice: 1.15,
    currency: "CNY",
    quotedUnit: "piece",
    unitPriceThb: 5.81808,
    fxRateMid: 4.96,
    fxRateApplied: 5.0592,
    fxRateAsOf: "2026-08-11",
    fxRateIsStale: false,
    leadTimeDays: 35,
    matchType: "exact",
    alternativeProductName: null,
    detailNotes: null,
    quotedAt: "2026-08-12",
    sourcedByUserId: "user-wei",
    sourcedByName: "Wei Zhang",
  },
  /* The Owner's own, and the only Item they have priced — which is what leaves them
     owing the two the outstanding band names on their screen. */
  {
    id: "q3b",
    tenderItemId: "item-syringes",
    supplierName: "Siam Pharma Supply Co., Ltd.",
    unitPrice: 5.4,
    currency: "THB",
    quotedUnit: "piece",
    unitPriceThb: 5.4,
    fxRateMid: 1,
    fxRateApplied: 1,
    fxRateAsOf: "2026-08-14",
    fxRateIsStale: false,
    leadTimeDays: 10,
    matchType: "exact",
    alternativeProductName: null,
    detailNotes: null,
    quotedAt: "2026-08-14",
    sourcedByUserId: "user-somchai",
    sourcedByName: "Somchai Prasertkul",
  },
];

/** One Item's Quotes in entry order — unranked, the way `listQuotes` leaves them. */
function quotesOn(tenderItemId: string): Quote[] {
  return everyQuote.filter((quote) => quote.tenderItemId === tenderItemId);
}

/** The gloves Item's whole record: the Owner's list, and the Quote the edit screen corrects. */
const gloveQuotes = quotesOn(gloves.id);

/**
 * The Item's Selected Quote: the Owner picked Wei's, neither of Nok's.
 *
 * Which is why the reduced screen is handed `null` in its place —
 * `loadItemSourcingScreen` drops a selection naming a Quote the reader was not given,
 * because an id pointing into a list it is not in is a dangling reference and the row it
 * warns about is not on the screen.
 */
const selectedGloveQuoteId = "q1c";

/**
 * The same Item narrowed to one Assignee, asked through the predicate the loaders narrow
 * with rather than written out by hand — so this fixture cannot draw somebody a row the
 * real screen would have taken away.
 */
const yourGloveQuotes = yourQuotes(gloveQuotes, "user-nok");

/**
 * Who said they could not source what.
 *
 * Keyed by Item because a `NoSupplierFound` does not carry one: it is read per Item and is
 * one Assignee's own within it. Assignees compete rather than divide (ADR-0004), so one of
 * them failing is a fact about their suppliers and never a verdict on the Item — which is
 * why the masks carry a refusal and two Quotes at once.
 */
const refusals = new Map<string, NoSupplierFound[]>([
  [
    "item-masks",
    [
      {
        userId: "user-nok",
        name: "Nok Wattanapong",
        note: "Discontinued by the manufacturer; the two importers left both quote a minimum order of ten thousand.",
        createdAt: "2026-08-13T04:00:00Z",
      },
    ],
  ],
]);

function refusalsOn(tenderItemId: string): NoSupplierFound[] {
  return refusals.get(tenderItemId) ?? [];
}

/**
 * What one reader still owes on this Tender: an Item they have neither Quoted nor given
 * up on, which is what an {@link OutstandingItem} is.
 *
 * Worked out here rather than listed, because the band and the sourcing below it are two
 * views of the same facts: a band naming an Item whose Quotes are drawn a few inches
 * under it is a screen the loader would never hand anybody. Nothing on this fixture is
 * decided and nothing is submitted, so the two conditions `outstandingFor` also applies
 * are not asked here.
 */
function yourOutstanding(callerId: string): OutstandingItem[] {
  return items
    .filter(
      (item) =>
        yourQuotes(quotesOn(item.id), callerId).length === 0 &&
        !refusalsOn(item.id).some((refusal) => refusal.userId === callerId),
    )
    .map((item) => ({ id: item.id, productName: item.productName }));
}

/**
 * The Tender's Items as one Assignee meets them on the reduced detail screen: their own
 * Quotes, their own refusal, and nothing of anybody else's — the shape `loadTenderScreen`
 * hands that screen, built the way it builds it.
 *
 * It is also the three states an Item is in there, each carrying the string on it nobody
 * chose the width of. For Nok: one Item with two Quotes on it — a supplier's full
 * registered name beside a price and a photo count — one given up on with a note they
 * typed, and one untouched. The refusal note is the only free text on the screen, and the
 * supplier names beside it are the only other strings the client and the supplier chose
 * the length of.
 */
function yourSourcing(callerId: string): SourcingItem[] {
  return items.map((item) => ({
    id: item.id,
    productName: item.productName,
    quantity: item.quantity,
    unit: item.unit,
    yourQuotes: yourQuotes(quotesOn(item.id), callerId),
    yourNoSupplierFound:
      refusalsOn(item.id).find((refusal) => refusal.userId === callerId) ?? null,
  }));
}

/**
 * Three photos on one of this reader's own Quotes, so the badge draws a count rather than
 * nothing — and none on the others, which is the map the loader really answers: a Quote
 * with no photos is absent from it rather than present and empty.
 */
const quotePhotos = new Map<string, QuotePhoto[]>([
  [
    "q1a",
    [1, 2, 3].map((n) => ({
      id: `p${n}`,
      url: "",
      uploadedAt: "2026-08-12T07:00:00Z",
      uploadedByName: "Nok Wattanapong",
    })),
  ],
]);

/** The client's own pictures for one Item, as both loaders hand them over. */
function imagesOn(tenderItemId: string): ReferenceImage[] {
  return referenceImages.filter((image) => image.tenderItemId === tenderItemId);
}

/** What the client sent, placed on the Item it is of. */
const referenceImages: ReferenceImage[] = [
  {
    id: "ref-1",
    tenderItemId: "item-gloves",
    url: "",
    uploadedAt: "2026-08-02T03:00:00Z",
    uploadedByName: "Somchai Prasertkul",
  },
];
