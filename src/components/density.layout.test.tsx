import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { column, controlRows, phone } from "@/test/layout";
import { locales, type Locale, Screen, screens } from "@/test/screens";

/**
 * **The reduction, as a number the build can fail on** (#98).
 *
 * `docs/simplification-scope.md` records that no colleague will test this work before it
 * ships. The acceptance test it would otherwise have had — *a colleague, untrained,
 * records a Quote on their phone in under two minutes* — is therefore not available as a
 * gate, and what stands in its place is this file. ADR-0016 says a check that cannot fail
 * is worse than no check, so the budgets below are set at exactly what the screens render,
 * with no headroom at all. Each was confirmed by producing the failure rather than reading
 * for it, which ADR-0016 says is the only review a check really gets: a button added to
 * `SourcingList` took the Tender detail from 8 rows to 11, one added to `QuoteForm` took
 * the sourcing screen to 11 and 10 and the form itself to 3, and the outstanding band's
 * link taken away dropped the Tender detail to 7 — the direction a ceiling would have
 * passed in silence.
 *
 * **An exact count, not a ceiling.** `toBe`, the way every other `controlRows` assertion in
 * this repo states itself, and not `toBeLessThanOrEqual`. A ceiling goes on passing when a
 * screen quietly stops drawing something, and from that moment it is a budget set above
 * what the screen renders — which is the thing #98 says is not a check, arrived at with
 * nobody editing a line. The cost is that a real reduction turns this red until somebody
 * writes the smaller number down, and that is the point: the number *is* the record, and
 * one that ratcheted downward in silence would tell nobody in three months whether
 * anything had happened.
 *
 * ## What it measures, and what it does not
 *
 * **Density, not comprehension.** `controlRows` counts distinct top edges among the links
 * and buttons a screen drew: how many separate rows of things there are to tap. That is a
 * proxy for how much a screen asks of the person reading it, and a crude one. It cannot
 * say whether a label is a phrase a new colleague knows, whether the order is the order
 * they work in, or whether anybody got a Quote entered. It counts links and buttons only,
 * so every field on the quote form — the price, the currency, the unit — is invisible to
 * it. A screen that halved its rows by putting half the work behind a menu would pass here
 * with the number improved and the person no better off.
 *
 * It is kept anyway, because it is the only thing that will tell anyone in three months
 * whether this work helped. The alternative is not a better number; it is an assertion in
 * a document that nothing checks.
 *
 * ## Which screens, and at what width
 *
 * The diagnosis in `docs/simplification-scope.md` named three screens as carrying nearly
 * all of the density. These are the two the reduction touched: the Tender detail as an
 * Assignee who does not own it reads it (ADR-0020), and the sourcing screen where that
 * Assignee records a price — what #98 calls *the quote form*. The third, the tender edit
 * screen, is the Owner's and was left alone.
 *
 * At 390×844, the layout project's viewport, because ADR-0021's rule is that the device
 * follows the role and an Assignee is on a phone for both of these. Width decides the
 * number — controls that share a row at a desk take two on a phone — so the count is the
 * phone's, which is the one a person actually has in front of them.
 *
 * **`main`, not the whole page.** The app bar's row and the bottom bar's are outside it,
 * deliberately: they are the same on every screen, they have their own suites holding each
 * to one row, and counting them here would move these numbers when the shell moved rather
 * than when the screen did.
 *
 * The screens themselves come from `@/test/screens`, so what is budgeted here is the same
 * composition `screens.layout.test.tsx` measures and the contact sheet photographs. They
 * are named inline rather than walked, which is what makes a screen renamed in that file a
 * type error at this call site rather than a budget left quietly measuring a column with
 * nothing in it.
 */

// Hoisted per file and therefore not shareable, the way `screens.layout.test.tsx` and the
// contact sheet each declare their own. See the note in `@/test/screens`.
vi.mock("@/app/actions/auth", () => ({ signOutAction: async () => ({}) }));
vi.mock("@/app/actions/admin", () => ({
  inviteAction: async () => ({}),
  setWecomUseridAction: async () => ({}),
  sendTestMentionAction: async () => ({}),
  setMembershipDisabledAction: async () => ({}),
  setGroupRobotAction: async () => ({}),
  setFxBufferAction: async () => ({}),
}));
vi.mock("@/app/actions/locale", () => ({ switchLocale: async () => ({}) }));
vi.mock("@/app/actions/tenders", () => ({
  addAssigneeAction: async () => ({}),
  removeAssigneeAction: async () => ({}),
}));
vi.mock("@/app/actions/quotes", () => ({
  createQuoteAction: async () => ({}),
  updateQuoteAction: async () => ({}),
  deleteQuoteAction: async () => ({}),
  recordNoSupplierFoundAction: async () => ({}),
  clearNoSupplierFoundAction: async () => ({}),
}));
vi.mock("@/app/actions/quote-photos", () => ({
  recordQuotePhotosAction: async () => ({}),
  removeQuotePhotoAction: async () => ({}),
  signQuotePhotoUploadsAction: async () => ({}),
}));

/**
 * The budgets, per locale.
 *
 * Two numbers rather than one wherever the locales disagree. A single budget covering both
 * would have to be the larger, and would hand the other locale a row of headroom — and a
 * budget above what the screen renders is not a check. The sourcing screen is the pair that
 * differs: on a saved Quote's row at 390px, *Take a photo* and *Choose photos* wrap onto
 * two rows where 拍照 and 从相册选择 fit on one. A Han glyph is about twice the width of a
 * Latin letter and this pair is still the narrower, which is exactly the reason #56 gives
 * for measuring both scripts instead of assuming English is the worst case.
 *
 * Typed rather than inferred: `Locale` is the union `@/test/screens` derives from the
 * locales it lists, so a third one added there is a failure here at `tsc` rather than a
 * budget that silently covers two scripts out of three.
 */
const budget = {
  tenderDetail: { en: 8, "zh-Hans": 8 },
  sourcingScreen: { en: 10, "zh-Hans": 9 },
  quoteForm: { en: 2, "zh-Hans": 2 },
} satisfies Record<string, Record<Locale, number>>;

describe(`the control-row budgets at ${phone.width}×${phone.height}`, () => {
  /**
   * **The Tender detail, read by an Assignee who does not own the Tender.**
   *
   * ADR-0020's screen: the comparison sheet and the Outcome panel are gone, and in their
   * place is a list of this reader's own work on each Item. What is left, on a Tender of
   * three Items, is eight rows — the header's own control, the one Item the outstanding
   * band still names for them, two image-count badges, one *Source this item* per Item,
   * and the control that takes them off the Tender.
   *
   * The fixture is the several-Item, several-Quote one #94 built, so the number is the
   * answer to a real Tender rather than to a Tender with one thing on it.
   */
  it.each(locales)(
    `holds the Tender detail somebody else owns to its budget: in %s`,
    (locale, m) => {
      render(
        <Screen locale={locale} messages={m}>
          {screens(m)["a tender somebody else owns"].body}
        </Screen>,
      );

      // The Items are really drawn, so a fixture that had quietly stopped reaching this
      // screen would fail here rather than pass by counting an empty column.
      expect(screen.getAllByText(m.tenders.sourcing.source)).toHaveLength(3);

      expect(controlRows(column())).toBe(budget.tenderDetail[locale]);
    },
  );

  /**
   * **The sourcing screen, where an Assignee records a price** — #98's *quote form*, and
   * one of the three `docs/simplification-scope.md` counted at 25 to 40 controls.
   *
   * **Two budgets, because either alone has a hole.** The screen's ten rows in English are
   * the client's picture on the brief; this reader's two own Quotes, each carrying its
   * photo controls and its Edit and Delete, one of them with three photographs to remove;
   * the form's own two; and the refusal box's one. A change that added a row to the form
   * while taking one off a Quote would leave that total exactly where it is and the form
   * denser, so the form is measured again on its own.
   *
   * Two is a small number and it is the whole of what `controlRows` can see here: the photo
   * pickers, and Save. Everything else on the form is a field, and a field has no place in
   * a count of links and buttons. As the only budget on this screen it would be a number
   * almost no change could move — the check that cannot fail wearing a smaller root
   * element — which is why it is the tighter half of a pair rather than a budget on its own.
   */
  it.each(locales)(`holds the sourcing screen to its budgets: in %s`, (locale, m) => {
    render(
      <Screen locale={locale} messages={m}>
        {screens(m)["sourcing an item on a tender somebody else owns"].body}
      </Screen>,
    );

    // Throws on none and on more than one, so the form is really on this screen — it is
    // drawn only for somebody the page would accept a Quote from — and the row below is
    // measured against the form it is actually in rather than the first one in the markup.
    const save = screen.getByText(m.quotes.save);

    expect(controlRows(column())).toBe(budget.sourcingScreen[locale]);
    expect(controlRows(save.closest("form")!)).toBe(budget.quoteForm[locale]);
  });
});
