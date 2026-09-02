import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import { deadlineReading } from "@/components/tenders/deadline-reading";
import { IndicatorLamp, toneTextClass } from "@/components/ui/indicator-lamp";
import { RowChevron } from "@/components/ui/row-chevron";
import { calendarDate, calendarDateFormat } from "@/lib/calendar-date";
import type { MyWorkRow } from "@/lib/tenders/my-work";

/**
 * **My work** — the Items this reader still owes a price on, one row each.
 *
 * The Item is the subject of the row, and that is the whole point of the screen. The
 * reminder that summoned somebody into the app names an Item; the worklist made them
 * navigate a Tender to reach it (ADR-0021). So the product name is the loud line here,
 * where on a tender row it is the client's name — and the client and the reference sit
 * above it as the thing that says *which supplier conversation this is*, not as the
 * subject.
 *
 * **Each row links straight to the quote form.** Not to the Tender, not to the Item
 * behind a tab: to the one screen where the price gets typed, because going from "I have
 * a price" to "it is recorded" is the entire job this list exists to shorten.
 *
 * **One deadline and one sentence**, in the same words the tender row uses — the keys are
 * `tenders.row.due.internal_quote.*` and the four readings come from `deadlineReading`,
 * shared with that row so the two cannot drift. It is always the Internal Quote Deadline:
 * that is the day this reader's answer is due, and the Client Submission Deadline is the
 * Owner's (see `sourcingDeadlineStatus`).
 *
 * **Empty is a state of this list, not a branch in the page.** The list is meant to reach
 * zero — that is the requirement rather than a side effect — so the sentence saying it
 * has is drawn here, beside the rows it replaces. Leaving it in the page would make the
 * screen's finished state the one thing no test could render, since the page is an
 * `async` Server Component no browser test can reach.
 *
 * **Composed at 390px** — an Assignee tapping a group link into the WeCom webview,
 * one-handed. Nothing is built for scale: no search, no filters, no pagination, no
 * collapsible groups, and no grouping at all.
 *
 * **Why every text-bearing child carries `min-w-0`.** A flex item's `min-width` defaults
 * to `auto`, so it refuses to shrink below its own longest unbroken word — and a product
 * name, a client name and a reference are all whatever somebody else called them, with no
 * space guaranteed anywhere in them. Without this a row holds itself wider than the phone
 * and takes the page with it (#56); `break-words` then gives the word somewhere to break.
 *
 * Sync, and taking only what it draws, for the reason `vitest.config.mts` gives: the page
 * is an `async` Server Component behind `currentUser` and is reachable by no browser test,
 * so this is the seam `screens.layout.test.tsx` measures instead.
 */
export function MyWorkList({ items }: { items: MyWorkRow[] }) {
  const t = useTranslations("myWork");

  // One emptiness, unlike the tender list's two. Nobody reaches this screen before their
  // org has recorded anything — an Assignee has to have been put on a Tender to have a
  // row at all — so "nothing recorded yet" and "you are on nothing" are the same sentence
  // here: you owe nobody a price.
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  }

  return (
    <div className="border-hairline bg-card min-w-0 overflow-hidden rounded-lg border">
      <ul className="flex min-w-0 flex-col">
        {items.map((item, index) => (
          <li
            key={item.itemId}
            className={index === 0 ? "min-w-0" : "border-hairline-soft min-w-0 border-t"}
          >
            <MyWorkItem item={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function MyWorkItem({ item }: { item: MyWorkRow }) {
  const t = useTranslations("tenders");
  const format = useFormatter();

  // `prefetch={false}` for the reason `tender-row.tsx` sets out at length: every route
  // here is dynamic, so the prefetch is bought and thrown away, one per row, all landing
  // at the moment somebody is about to tap.
  return (
    <Link
      href={`/tenders/${item.tenderId}/items/${item.itemId}/quote`}
      prefetch={false}
      className="hover:bg-signal/5 flex min-w-0 items-start gap-3 p-3.5 transition-colors"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          <span className="text-ink-faint min-w-0 font-mono text-xs font-medium break-words">
            {item.reference}
          </span>
          <span className="text-muted-foreground min-w-0 text-[13px] break-words">
            {item.clientName}
          </span>
        </div>

        <span className="min-w-0 text-[15px] font-semibold break-words">
          {item.productName}
        </span>

        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
          <IndicatorLamp tone={item.status.tone} />
          <span className={`min-w-0 break-words ${toneTextClass(item.status.tone)}`}>
            {t(`row.due.internal_quote.${deadlineReading(item.status.days)}`, {
              date: format.dateTime(
                calendarDate(item.internalQuoteDeadline),
                calendarDateFormat,
              ),
            })}
          </span>
        </div>
      </div>

      <RowChevron />
    </Link>
  );
}
