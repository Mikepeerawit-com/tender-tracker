import { NextIntlClientProvider, useTranslations } from "next-intl";

import "@/app/globals.css";

import { AppHeader, type AppLocation } from "@/components/app-header";
import { BottomNav } from "@/components/app-nav";
import { CurrencyConversionForm } from "@/components/admin/currency-conversion-form";
import { GroupRobotForm } from "@/components/admin/group-robot-form";
import { InviteForm } from "@/components/admin/invite-form";
import { MembershipList } from "@/components/admin/membership-list";
import { AuthScreen } from "@/components/auth/auth-screen";
import { ChooseLanguageOptions } from "@/components/auth/choose-language-options";
import { LoginForm } from "@/components/auth/login-form";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { SetupForm } from "@/components/auth/setup-form";
import { WorkingSheet } from "@/components/comparison/working-sheet";
import { ImageCountBadge } from "@/components/images/image-count-badge";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { EditQuoteForm } from "@/components/quotes/edit-quote-form";
import { ItemBrief } from "@/components/quotes/item-brief";
import { NoSupplierFoundForm } from "@/components/quotes/no-supplier-found-form";
import { QuoteList } from "@/components/quotes/quote-list";
import { SettingsFrame } from "@/components/settings/settings-nav";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { AssigneeControls } from "@/components/tenders/assignee-controls";
import { EditTenderForm } from "@/components/tenders/edit-tender-form";
import { MyWorkList } from "@/components/tenders/my-work-list";
import { NewTenderForm } from "@/components/tenders/new-tender-form";
import { OutstandingBand } from "@/components/tenders/outstanding-band";
import { ReferenceImageGallery } from "@/components/tenders/reference-image-gallery";
import { ReferenceImageUploader } from "@/components/tenders/reference-image-uploader";
import { SourcingList } from "@/components/tenders/sourcing-list";
import {
  AddTenderItemForm,
  EditTenderItemForm,
} from "@/components/tenders/tender-item-forms";
import { TenderFacts } from "@/components/tenders/tender-facts";
import { TenderGroup } from "@/components/tenders/tender-group";
import { QuoteForm } from "@/components/quotes/quote-form";
import { Button } from "@/components/ui/button";
import {
  Measure,
  type MeasureWidth,
  ScreenBody,
  type ScreenGap,
} from "@/components/ui/screen-body";
import { ScreenError } from "@/components/ui/screen-error";
import { ScreenHeader } from "@/components/ui/screen-header";
import { ScreenSkeleton } from "@/components/ui/screen-skeleton";
// A type only, and it has to stay one: the module is `server-only`, so a value
// imported from it would throw the moment a browser test loaded this file.
import type { SheetItem } from "@/lib/comparison/sheet";
import type { QuotePhoto } from "@/lib/images/quote-photos";
import type { ReferenceImage } from "@/lib/images/reference-images";
import type { Member, Membership, OwnerOption } from "@/lib/org/members";
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
 * **This record is the seam every layout guard is built on, and since #131 that is a
 * promise rather than a happy accident.** A screen added below inherits all of them with
 * nothing else to remember: no sideways scroll at 390px in both locales, the region at the
 * desk, the bar and the body sharing a left edge, the one-row app bar, and a contrast walk
 * over every word in both themes. What used to sit outside it — a hand-maintained table of
 * per-screen widths in `screens.layout.test.tsx`, kept honest by a reconciliation test —
 * has moved *into* each entry as `measure`, so there is one place to add a screen and one
 * place to state what it commits to.
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
 * **`measure` is the width that screen's prose and its form fields commit to**, in the
 * pixels a reader gets — the narrower column inside the region (ADR-0022). It is declared
 * here, beside the composition it is a claim about, because it is the one thing the region
 * rule leaves varying: the region is a single number stated once in the guard, and this is
 * not. Stated in pixels rather than as the `MeasureWidth` handed to `ScreenBody`, so that
 * the number asserted comes from somewhere other than the code under test — a declaration
 * that read the same token the component does could only ever agree with itself.
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
    "my work": {
      measure: 768,
      body: (
        <Body>
          <ScreenHeader heading={m.myWork.title}>
            <p className="text-muted-foreground text-sm break-words">
              {m.myWork.description}
            </p>
          </ScreenHeader>
          <MyWorkList items={myWorkRows} />
        </Body>
      ),
    },
    // The same screen with the work done, which is a screen in its own right rather than
    // the one above with rows removed: it draws one sentence and no list at all, and the
    // list reaching zero is the requirement this destination is built around.
    "my work, finished": {
      measure: 768,
      body: (
        <Body>
          <ScreenHeader heading={m.myWork.title}>
            <p className="text-muted-foreground text-sm break-words">
              {m.myWork.description}
            </p>
          </ScreenHeader>
          <MyWorkList items={[]} />
        </Body>
      ),
    },
    "the tender list": {
      measure: 768,
      body: (
        <Body>
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
    },
    // ── The Owner's two forms, which until #143 no record held ──────────────────────
    //
    // Both are real routes carrying real forms, and neither was in this file — so neither
    // was in a single guard this record confers. It is the fault #135 found on the working
    // sheet, one ticket later and on two more screens, and ADR-0019 already carries the
    // lesson: a contrast claim, a focus ring, a tap floor and a region width are each a
    // claim about a *list of surfaces*, and the list is only as long as the screens
    // somebody measured.
    "recording a tender": {
      measure: 768,
      body: (
        // `gap-6` because the page sets it: this screen is one long form, and the wider
        // rhythm every other screen uses would push the submit off a phone.
        <Body gap="gap-6">
          <ScreenHeader heading={m.tenders.record}>
            <p className="text-muted-foreground text-sm">{m.tenders.recordDescription}</p>
          </ScreenHeader>
          <Measure>
            {/* The Owner recording it defaults to themselves, and the form opens on one
                Item row — both the state a reader really arrives at. The per-row Remove
                beside a second row is one press away and so is on no screen at rest;
                `target.layout.test.tsx` presses the button and measures it there. */}
            <NewTenderForm members={ownerChoices} defaultOwnerId="user-somchai" />
          </Measure>
        </Body>
      ),
    },
    "a tender": {
      measure: 768,
      body: (
        <Body location={tenderBar}>
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
          {/* The densest thing in the app, and until #135 the one screen no shared guard
              could see: it was measured only by its own suite, on a bare page, in one
              locale and one theme. `--money-red` and `--money-green` are drawn here and
              nowhere else, so a Margin that went unreadable in the dark was a defect with
              no test standing anywhere near it. */}
          <WorkingSheet
            tenderId={tender.id}
            items={sheetItems}
            photos={quotePhotos}
            referenceImages={referenceImages}
          />
          <AssigneeControls
            tenderId={tender.id}
            assignees={tender.assignees}
            members={members}
            callerId="user-somchai"
            isOwner
          />
        </Body>
      ),
    },
    // The same route, drawn for somebody who does not own the Tender (ADR-0020, #92).
    // A screen in its own right rather than a variant of the one above: it has the sheet
    // and the Outcome panel taken out and a list of your own sourcing put in, and that
    // list is markup no other screen draws.
    "a tender somebody else owns": {
      measure: 768,
      body: (
        <Body location={tenderBar}>
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
    },
    // The Owner's other form, and the densest screen in the app after the working sheet:
    // the Tender's own fields, one form per Item, an uploader, a gallery of the client's
    // pictures with a picker on every one, and the Assignee controls under all of it.
    "editing a tender": {
      measure: 768,
      body: (
        <Body location={editBar}>
          <ScreenHeader eyebrow={tender.reference} heading={m.tenders.edit}>
            <p className="text-muted-foreground text-sm">{m.tenders.editDescription}</p>
          </ScreenHeader>

          <Measure>
            <EditTenderForm
              tenderId={tender.id}
              members={ownerChoices}
              defaults={tender}
            />
          </Measure>

          <Measure>
            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-sm font-medium">{m.tenders.item.plural}</h2>
                <p className="text-muted-foreground text-xs">{m.tenders.item.hint}</p>
              </div>

              {/* All three Items, and `removable` on every one — the Tender has more than
                  one, so the destructive Remove is drawn per row. A fixture with a single
                  Item would compose the one shape of this screen that has no Remove on it
                  at all. */}
              {tender.items.map((item) => (
                <EditTenderItemForm
                  key={item.id}
                  tenderId={tender.id}
                  item={item}
                  removable
                />
              ))}

              <AddTenderItemForm tenderId={tender.id} />
            </section>
          </Measure>

          {/* Outside the measure, as the page draws it: the gallery is a grid of tiles
              scanned rather than a line of prose read along. */}
          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-medium">{m.tenders.referenceImages.title}</h2>
            <ReferenceImageUploader tenderId={tender.id} />
            <ReferenceImageGallery
              tenderId={tender.id}
              images={referenceImages}
              items={tender.items}
            />
          </section>

          <AssigneeControls
            tenderId={tender.id}
            assignees={tender.assignees}
            members={members}
            callerId={tender.ownerUserId}
            isOwner
          />
        </Body>
      ),
    },
    "sourcing an item": {
      measure: 768,
      body: (
        <Body location={itemBar}>
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
          <Measure>
            <QuoteForm
              tenderId={tender.id}
              tenderItemId={gloves.id}
              defaults={blankQuote({ unit: gloves.unit, today: "2026-08-12" })}
            />
          </Measure>
        </Body>
      ),
    },
    // The same route, drawn for an Assignee who does not own the Tender (ADR-0020, #93):
    // their own Quotes and nobody else's, counted in words that say whose they are. This
    // is the screen the reduction is really for — an Assignee opens it several times per
    // Item off a run of supplier calls, and it is the one place they type anything — so
    // it is composed whole here, down to the form and the refusal box the Owner's copy
    // above leaves out.
    "sourcing an item on a tender somebody else owns": {
      measure: 768,
      body: (
        <Body location={itemBar}>
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

          <Measure>
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
          </Measure>

          {/* The third state, in the dashed box the page gives it: an Assignee saying
              they could not source this at all. It draws the form rather than a record,
              because nobody has given up on the gloves — this reader has not, and the two
              colleagues who could have have both priced them instead. A colleague's note,
              when there is one, is shown as fact and is measured on the Tender detail. */}
          <Measure>
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
          </Measure>
        </Body>
      ),
    },
    "correcting a quote": {
      measure: 768,
      body: (
        <Body location={itemBar}>
          <ScreenHeader
            eyebrow={`${tender.reference} · Nitrile examination glove, powder-free, size M`}
            heading={m.quotes.editTitle}
          >
            <SourcedBy name={gloveQuotes[0].sourcedByName} />
          </ScreenHeader>
          <Measure>
            <EditQuoteForm
              tenderId={tender.id}
              tenderItemId={gloves.id}
              quoteId={gloveQuotes[0].id}
              // A non-THB Quote, so the read-only currency cell is drawn carrying a real
              // currency rather than the reporting one it would default to.
              currency={gloveQuotes[0].currency}
              defaults={quoteAsSubmitted(gloveQuotes[0])}
            />
          </Measure>
        </Body>
      ),
    },
    // ── Settings: one destination, two groups, four screens ────────────────────────
    //
    // The three Org Admin screens arrived here in #131. Nothing measured them before: each
    // is an `async` Server Component behind an `isOrgAdmin` gate, and the record they were
    // missing from is the one every layout guard is built on — so the three screens whose
    // left edge ADR-0022 is most visibly about were the three nothing could see. They are
    // also where the second measure in the app is drawn, which is what keeps the
    // per-screen half of that guard a claim rather than one number repeated.
    //
    // #132 put them behind one destination and gave them a sub-navigation column, so they
    // are composed through `SettingsBody` now — the frame the router really assembles.
    // Preferences is the fourth, and it is here **twice**: an Org Admin's, whose column
    // carries both groups, and a member's, whose column carries Preferences alone. That
    // second one is the screen story 6 of #129 is about, and the only composition in the
    // app that differs by who is looking — which is why it is a screen in its own right
    // here rather than a case inside another suite.
    "the Preferences screen": {
      measure: 672,
      body: <SettingsBody>{preferences(m)}</SettingsBody>,
    },
    "the Preferences screen, for a member who is not an Org Admin": {
      measure: 672,
      body: <SettingsBody isOrgAdmin={false}>{preferences(m)}</SettingsBody>,
    },
    "the People screen": {
      measure: 672,
      body: (
        <SettingsBody>
          <ScreenHeader heading={m.people.title}>
            <p className="text-muted-foreground text-sm">{m.people.description}</p>
          </ScreenHeader>

          <Measure>
            <section className="border-border flex flex-col gap-4 rounded-lg border p-4">
              <h2 className="text-sm font-medium">{m.people.invite.title}</h2>
              <InviteForm />
            </section>
          </Measure>

          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-medium">{m.people.members}</h2>
            <MembershipList members={memberships} />
          </section>
        </SettingsBody>
      ),
    },
    "the WeCom group screen": {
      measure: 672,
      body: (
        <SettingsBody>
          <ScreenHeader heading={m.groupRobot.title}>
            <p className="text-muted-foreground text-sm">{m.groupRobot.description}</p>
          </ScreenHeader>

          <Measure>
            <section className="border-border flex flex-col gap-4 rounded-lg border p-4">
              {/* Set up, which is the fuller of the two shapes: it draws the sentence
                  saying when it was last changed and the control that removes it, neither
                  of which exists on an org that has never saved one. */}
              <GroupRobotForm configured updatedAt="2026-08-20T09:15:00Z" />
            </section>
          </Measure>
        </SettingsBody>
      ),
    },
    "the converting-foreign-prices screen": {
      measure: 672,
      body: (
        <SettingsBody>
          <ScreenHeader heading={m.currencyConversion.title}>
            <p className="text-muted-foreground text-sm">{m.currencyConversion.description}</p>
          </ScreenHeader>

          <Measure>
            <section className="border-border flex flex-col gap-4 rounded-lg border p-4">
              <CurrencyConversionForm percent={2.5} />
            </section>
          </Measure>

          <Measure>
            <p className="text-muted-foreground text-sm">{m.currencyConversion.affects}</p>
          </Measure>
        </SettingsBody>
      ),
    },
    // The two screens that stand in for the others, and are screens in their own right:
    // whoever taps a link on a phone sees the first of these before anything else, and
    // sees the second instead of a blank page when the fetch behind it fails (#57).
    // Neither is wrapped in `Body` — a route-level `loading.tsx` and `error.tsx` replace
    // the page, so each has to draw the page's own wrapper itself, and does.
    "the loading fallback": {
      measure: 768,
      body: (
        <>
          <AppHeader />
          <ScreenSkeleton />
        </>
      ),
    },
    // A digest of the length Next really mints, since it is the one string on this screen
    // that nobody chose the width of.
    "a screen that threw": {
      measure: 768,
      body: (
        <>
          <AppHeader />
          <ScreenError digest="3990102495" retry={() => {}} />
        </>
      ),
    },
  };
}

/**
 * **The screens reached before signing in**, which the record above cannot hold.
 *
 * They have no `(app)` shell — no app bar, no bottom bar, and a `main` of their own at
 * `max-w-sm` rather than the region — so they are composed through {@link SignedOut}
 * instead of {@link Screen}, and the width and region guards leave them to
 * `auth-screen.layout.test.tsx`. What they share with everything else is the palette, the
 * type and the controls, which is exactly what the colour, keyboard and motion suites ask
 * about — so those three walk this record and the one above, and neither has a screen the
 * other cannot see.
 *
 * **All four, since #135.** Only the sign-in screen was ever measured, hand-composed twice
 * over in two suites, and the reason given was that `LoginForm` is the busiest of the
 * three forms. That is true of a *width* — the busiest column is the one that pushes — and
 * it is not true of a colour: `/setup` draws a shared-secret field with a hint under it
 * that no other screen has, and `/choose-language` draws no field at all and two full-width
 * buttons instead. A palette that failed on either would have failed unwatched.
 *
 * Each is a fragment rather than a whole page, for the reason the record above gives:
 * whoever is drawing it decides the theme and the locale.
 *
 * **`body` on each entry, the way {@link screens} carries one**, though there is nothing
 * beside it here and no `measure` for a signed-out screen to commit to. The three suites
 * that walk both records walk them in the same line of code, and a record that answered a
 * bare node would make each of them write the difference out — which is five places to get
 * it wrong, to save one word.
 */
export function signedOutScreens(m: Messages) {
  return {
    "the sign-in screen": {
      body: (
        <AuthScreen title={m.login.title} description={m.login.description}>
          <LoginForm />
        </AuthScreen>
      ),
    },
    // Where somebody invited into the org lands from their email link, and the only
    // screen in the app with two password fields on it.
    "the set-a-password screen": {
      body: (
        <AuthScreen title={m.setPassword.title} description={m.setPassword.description}>
          <SetPasswordForm />
        </AuthScreen>
      ),
    },
    // The guarded screen the very first Org Admin arrives through (ADR-0017). The longest
    // signed-out form there is, and the only one carrying a hint under a field.
    "the first-admin setup screen": {
      body: (
        <AuthScreen title={m.setup.title} description={m.setup.description}>
          <SetupForm />
        </AuthScreen>
      ),
    },
    // Asked before anything else, and drawn in both languages at once because whoever is
    // reading it cannot yet be assumed to read either (ADR-0011). No field on it at all,
    // which makes it the one signed-out screen that is nothing but controls.
    "the choose-a-language screen": {
      body: (
        <AuthScreen title={m.chooseLanguage.title}>
          <ChooseLanguageOptions />
        </AuthScreen>
      ),
    },
  };
}

/**
 * A signed-out screen, in the box the real `body` gives it.
 *
 * {@link Screen}'s two lines minus the shell: the same {@link Ground}, so the theme is
 * carried the same way, and the same full-height flex column, because `AuthScreen` takes
 * `flex-1` inside it and centres itself in what that gives — which it can only do if
 * something above it has a height.
 */
export function SignedOut({
  locale,
  messages,
  theme = "light",
  children,
}: {
  locale: Locale;
  messages: Messages;
  theme?: Theme;
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
      <Ground theme={theme}>
        <div className="flex min-h-dvh flex-col">{children}</div>
      </Ground>
    </NextIntlClientProvider>
  );
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
 *
 * **`theme` is a parameter of this wrapper and not of any one suite**, so that a screen
 * added to the record above is measured in both themes by whatever already measures it,
 * and neither theme is a parallel seam somebody has to remember. It defaults to light,
 * which is what every suite predating a theme was measuring anyway.
 */
export function Screen({
  locale,
  messages,
  theme = "light",
  children,
}: {
  locale: Locale;
  messages: Messages;
  theme?: Theme;
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
      <Ground theme={theme}>
        <div className="flex min-h-dvh flex-col">
          {children}
          <BottomNav />
        </div>
      </Ground>
    </NextIntlClientProvider>
  );
}

/** The two themes the token file answers. */
export const themes = ["light", "dark"] as const;

export type Theme = (typeof themes)[number];

/**
 * The ground a screen is drawn on, carrying the theme the way the real root carries it.
 *
 * The class is what `.dark` in `globals.css` selects on, and the two utilities are what
 * `@layer base` gives the real `body` — stated again here because a wrapper that only set
 * the class would redefine every token and then paint them onto nothing, leaving a dark
 * screen on a white page.
 *
 * Exported for the signed-out screens, which have no `(app)` shell around them and so
 * cannot reach it through {@link Screen}: it is the same ground either way, which is the
 * point of it being one component.
 */
export function Ground({
  theme,
  children,
}: {
  theme: Theme;
  children: React.ReactNode;
}) {
  return (
    <div className={`${theme === "dark" ? "dark " : ""}bg-background text-foreground`}>
      {children}
    </div>
  );
}

/**
 * A whole `(app)` page: its own app bar, then the wrapper it draws its body inside.
 *
 * **`Screen`'s two lines, exactly.** It drew its own copy of the wrapper's markup until
 * #97, which was a copy that could drift from the component every page really uses — and
 * the thing #97 changed is exactly that markup, so a suite measuring the copy would have
 * measured nothing. `ScreenBody` and `AppHeader` are both sync and reach for nothing, so
 * this composes them and there is nothing left standing in for anything: `Screen` stopped
 * reading the session in #132, when the bar stopped varying by who was looking at it.
 *
 * `location` is a prop rather than something chosen here, because since #73 each page
 * draws the bar shape that names *where it is* — the list gets the wordmark, a Tender and
 * the sourcing screen get the record form with a reference and a client name in it.
 * Composing the wrong one would measure a screen the router never assembles.
 *
 * **`measure` is one value and reaches the body alone**, exactly as `Screen` hands it:
 * nothing about a width reaches the bar any more, because there is one region and it is
 * written on both sides rather than passed (ADR-0022).
 */
export function Body({
  measure,
  location,
  gap,
  children,
}: {
  measure?: MeasureWidth;
  location?: AppLocation;
  /** What `@/components/screen`'s `Screen` takes and this did not. One screen sets it. */
  gap?: ScreenGap;
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Nothing about the reader is handed in since #132: the app menu holds `Settings`
          and `Sign out` for everybody, so there is one bar rather than an admin's and a
          member's, and this composition is the one every member gets. */}
      <AppHeader location={location} />
      <ScreenBody measure={measure} gap={gap}>
        {children}
      </ScreenBody>
    </>
  );
}

/**
 * A **Settings** screen, in the frame `(app)/settings/layout.tsx` really draws round it.
 *
 * The four screens under Settings share a layout rather than each composing their own, so
 * a fixture that drew only the page's own body would measure a screen the router never
 * assembles — with no sub-navigation column beside it and therefore none of the width it
 * takes off the measure at the desk.
 *
 * **The frame is {@link SettingsFrame}, imported rather than retyped**, for the reason at
 * the head of this file: a copy of the layout's markup here is a copy that drifts from
 * what a reader gets, and a padding changed in the real layout would fail nothing. What
 * is left is the two things the layout states about a Settings screen — the measure, and
 * who is looking.
 *
 * `isOrgAdmin` is the one thing that varies, and it varies for the reader rather than for
 * the screen: it decides whether the Organisation group is drawn in the column, which is
 * the whole of what #132 changed about what a member who administers nothing can see.
 */
export function SettingsBody({
  isOrgAdmin = true,
  children,
}: {
  isOrgAdmin?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Body measure="42rem">
      <SettingsFrame isOrgAdmin={isOrgAdmin}>{children}</SettingsFrame>
    </Body>
  );
}

/**
 * The Preferences screen's own body, which is in the record twice — once inside an Org
 * Admin's column and once inside a member's — and is the same screen both times. Only the
 * column around it differs, which is the whole of what the two entries are contrasting.
 */
function preferences(m: Messages) {
  return (
    <>
      <ScreenHeader heading={m.preferences.title}>
        <p className="text-muted-foreground text-sm">{m.preferences.description}</p>
      </ScreenHeader>

      <Measure>
        <section className="border-border flex flex-col gap-4 rounded-lg border p-4">
          <h2 className="text-sm font-medium">{m.localeSwitcher.label}</h2>
          <LocaleSwitcher />
        </section>

        {/* `system` because it is what a member who has never opened this screen holds,
            and because it is the widest of the three in both scripts — 跟随系统 is four Han
            glyphs against two. A fixture pinned to a shorter answer would measure the easy
            case of a row that has to fit three thumb-sized targets at 390px. */}
        <section className="border-border flex flex-col gap-4 rounded-lg border p-4">
          <h2 className="text-sm font-medium">{m.themeSwitcher.label}</h2>
          <ThemeSwitcher current="system" />
        </section>
      </Measure>
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

/**
 * "Sourced by Nok Wattanapong", as the correct-a-Quote page draws it under its heading.
 *
 * A component for the reason {@link YourQuotesHeading} is one: it is a message with a
 * value in it, and the raw ICU pasted into the markup would draw its own source rather
 * than the words a reader sees.
 */
function SourcedBy({ name }: { name: string }) {
  const t = useTranslations("quotes");

  return (
    <p className="text-muted-foreground text-sm break-words">{t("sourcedBy", { name })}</p>
  );
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

/**
 * The same bar one screen further in: the edit screen's back goes to the Tender it is
 * editing rather than to the list, and that is the whole of what differs.
 */
const editBar = { ...tenderBar, backHref: "/tenders/8f14e45f" } as const;

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

/**
 * The Owner picker's options on both of the Owner's forms.
 *
 * `ownerOptions` builds these in the app and is `server-only`, so they are written out
 * here rather than computed — the same reason `SheetItem` is a type import at the head of
 * this file.
 *
 * **Every one of them current, and the `former` label deliberately not composed.** A
 * Tender whose Owner has since been disabled draws that Owner as *"… (no longer a
 * member)"*, which is the longest string the picker can hold — but `NativeSelect` is
 * `w-full min-w-0`, so an option's text is not a width this record could measure either
 * way. Composing a departed Owner here would buy a longer string that changes no
 * rectangle, and would cost the fixture its agreement with `tender`, whose Owner is one
 * of the four members above.
 */
const ownerChoices: OwnerOption[] = members.map((member) => ({
  ...member,
  former: false,
}));

/**
 * The org as the People screen reads it: one Org Admin, one ordinary member, one already
 * Disabled, and one with no `wecom_userid` recorded.
 *
 * The four together are the widest that screen gets — both badges are drawn, and the Test
 * Mention control is drawn in both of its states — which is what a row measured at 390px
 * has to hold. The names are the same colleagues the pickers elsewhere in this file name,
 * because two fixtures naming two different orgs would photograph as two products.
 */
const memberships: Membership[] = [
  {
    id: "user-somchai",
    name: "Somchai Prasertkul",
    email: "somchai@taihue.example",
    wecomUserid: "SomchaiP",
    isOrgAdmin: true,
    disabledAt: null,
  },
  {
    id: "user-nok",
    name: "Nok Wattanapong",
    email: "nok@taihue.example",
    wecomUserid: "NokW",
    isOrgAdmin: false,
    disabledAt: null,
  },
  {
    id: "user-wei",
    name: "Wei Zhang",
    email: "wei@taihue.example",
    // Nobody has recorded one, so the Test Mention control is drawn in the state that
    // cannot be pressed — which is the half of that row an org with a new colleague in it
    // actually sees.
    wecomUserid: null,
    isOrgAdmin: false,
    disabledAt: null,
  },
  {
    id: "user-ploy",
    name: "Ploy Sirikanya",
    email: "ploy@taihue.example",
    wecomUserid: "PloyS",
    isOrgAdmin: false,
    disabledAt: "2026-07-30T02:11:00Z",
  },
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
    // A Stale Rate, and the cheapest row on the Item — which is the pair `tooCloseToCall`
    // exists for: it leads the next Quote by 2.4%, and a lead that narrow can be an
    // artifact of two rates frozen a week apart rather than a real difference in price.
    // It is what makes the working sheet draw a banner at all on this fixture.
    fxRateAsOf: "2026-08-04",
    fxRateIsStale: true,
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
     owing the two the outstanding band names on their screen.

     It is also **priced by the box against an Item the client buys by the piece**, which
     is the one thing the comparison sheet refuses to rank rather than quietly dividing by
     a hundred to get a comparable figure (ADR-0009). That refusal is the Item's
     `unit_mismatch` banner, and the only surface in the app drawn in `--destructive` over
     its own wash — so it is the one this fixture has to draw for #135's sweep to have
     seen it in the dark. */
  {
    id: "q3b",
    tenderItemId: "item-syringes",
    supplierName: "Siam Pharma Supply Co., Ltd.",
    unitPrice: 540,
    currency: "THB",
    quotedUnit: "box of 100",
    unitPriceThb: 540,
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
 * The Tender's Items as the **comparison working sheet** reads them — the Owner's half of
 * the detail screen (ADR-0020), and the only place in the app a money direction hue is
 * drawn at all.
 *
 * Built from the same `items` and the same Quotes as everything else here, through
 * {@link sheetItem}, so the sheet and the sourcing screens cannot come to disagree about
 * what the client asked for or what anybody quoted. What is stated below is only the four
 * facts a `SheetItem` carries that a `TenderItem` does not: whether the Item is decided,
 * and the two prices with the confirmation between them.
 *
 * **Between them the three Items draw every surface this screen can reach**, which is
 * what makes them worth composing rather than listing:
 *
 * - **The gloves are undecided**, so the Item opens and the ranked quote table is drawn —
 *   the rank-1 chip in signal, the Alternative's flag tint and chip, the Stale Rate
 *   marking, and the photo and reference-image badges. That stale rate on the cheapest row
 *   is also what raises the `warn` banner: a 2.4% lead frozen a week apart is a lead the
 *   sheet declines to trust. The landed cost is Confirmed and the selling price is above
 *   it, so the Margin is a **gain** — green in `en`, and red in `zh-Hans` (ADR-0023).
 * - **The masks are decided**, on the Quote whose supplier is the unbroken run — which is
 *   what puts a 44-character token with nowhere to break in the narrowest column on the
 *   screen. Their landed cost is Unconfirmed, so the Margin is drawn **provisional** in
 *   flag ink rather than in a direction (ADR-0014), and Nok's refusal puts the second
 *   sourcing chip beside the first.
 * - **The syringes are undecided and unrankable** — the Owner quoted them by the box
 *   against an Item the client buys by the piece — so they carry the `stop` banner, the
 *   one surface in the app drawn in `--destructive` over its own wash. Sold under what
 *   they cost, so the Margin is a **loss**, and therefore the other hue of the pair on the
 *   same screen as the gain.
 *
 * A screen with one Margin on it would photograph as a screen with one hue on it, and the
 * risk #129 leaves open — a gain and a passed deadline both red in `zh-Hans` — can only be
 * judged where both directions are on screen at once.
 */
const sheetItems: SheetItem[] = [
  sheetItem(items[0], {
    selectedQuoteId: null,
    landedCostPerUnit: 2.08,
    landedCostConfirmedAt: "2026-08-14T04:00:00Z",
    sellingPricePerUnit: 2.6,
  }),
  sheetItem(items[1], {
    selectedQuoteId: "q2a",
    landedCostPerUnit: 316.2,
    // Nothing added for shipping, duty or handling yet (ADR-0014), which is what makes
    // the Margin beside it provisional rather than a direction.
    landedCostConfirmedAt: null,
    sellingPricePerUnit: 372,
  }),
  sheetItem(items[2], {
    // Two numbers somebody typed while deciding, on an Item nothing has been chosen on:
    // the Margin is what they are moving the selling price to find, and it recomputes as
    // they type. Unrankable is not the same as unpriceable.
    selectedQuoteId: null,
    landedCostPerUnit: 5.82,
    landedCostConfirmedAt: "2026-08-14T05:00:00Z",
    sellingPricePerUnit: 5.4,
  }),
];

/**
 * One Item as the sheet reads it: the Item, its Quotes, and the pricing stated beside it.
 *
 * The Quotes and the sourcing record are **derived rather than repeated** — `quotesOn` and
 * `refusalsOn` are the same two functions every other fixture in this file asks — so a
 * Quote added above appears on the sheet without anybody remembering to add it twice, and
 * a count here cannot drift from the rows it is counting.
 */
function sheetItem(
  item: TenderItem,
  pricing: Pick<
    SheetItem,
    | "selectedQuoteId"
    | "landedCostPerUnit"
    | "landedCostConfirmedAt"
    | "sellingPricePerUnit"
  >,
): SheetItem {
  const quotes = quotesOn(item.id);

  return {
    id: item.id,
    productName: item.productName,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    quotes,
    sourcing: { quoteCount: quotes.length, noSupplierFound: refusalsOn(item.id) },
    ...pricing,
  };
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
