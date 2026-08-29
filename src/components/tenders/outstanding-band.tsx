import Link from "next/link";
import { useTranslations } from "next-intl";

import { IndicatorLamp } from "@/components/ui/indicator-lamp";
import type { OutstandingItem } from "@/lib/tenders/tender-screen";

/**
 * What *this reader* still owes on this Tender, at the top of the screen.
 *
 * An Assignee who is nagged by the Group Robot, taps the link and lands here used to be
 * shown the Owner's price-comparison sheet with no statement anywhere of what they
 * personally had to do — the nag and the job several taps apart, through somebody else's
 * screen. Each Item named here is a direct link to its sourcing screen, so they are one
 * tap apart instead.
 *
 * This is also why no per-Item deep link was added to the reminder. The Internal Quote
 * Deadline reminder is one message per Tender mentioning *every* Assignee still owing
 * Quotes, each of whom owes different Items, so no single Item is the right destination
 * for a link the whole group reads. Resolving it per-viewer on arrival is what makes
 * landing on the Tender useful.
 *
 * **Drawn in signal, not alarm.** It says something is expected of the reader, which is
 * exactly what signal means; alarm is time and only time (ADR-0019). And colour is not
 * the only copy of that meaning — the heading says it in words, the count says how much,
 * and each Item is a named link.
 *
 * **Not drawn at all when there is nothing outstanding.** That is what makes it mean
 * something when it is there: a band that were always present, greyed out or reading
 * "nothing outstanding", would be one more thing to learn to skip past.
 */
export function OutstandingBand({
  tenderId,
  items,
}: {
  tenderId: string;
  items: OutstandingItem[];
}) {
  const t = useTranslations("tenders");

  if (items.length === 0) return null;

  return (
    <section className="border-signal-edge bg-signal-wash flex min-w-0 flex-col gap-2 rounded-lg border p-3.5">
      <div className="flex min-w-0 items-center gap-2">
        <IndicatorLamp tone="signal" size={15} />
        <h2 className="text-signal-ink min-w-0 text-[13px] font-semibold break-words">
          {t("outstanding.title")}
        </h2>
        <span className="text-signal-ink ml-auto shrink-0 font-mono text-[13px] font-medium">
          {items.length}
        </span>
      </div>

      <p className="text-signal-ink/85 min-w-0 text-xs leading-relaxed break-words">
        {t("outstanding.hint")}
      </p>

      <ul className="flex min-w-0 flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.id} className="min-w-0">
            {/* `prefetch={false}` for the reason `tender-row.tsx` gives at length: every
                route here is dynamic, so the prefetch is bought and thrown away. */}
            <Link
              href={`/tenders/${tenderId}/items/${item.id}/quote`}
              prefetch={false}
              className="border-signal-edge bg-card text-signal-ink hover:bg-signal-wash flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors"
            >
              <span className="min-w-0 break-words">{item.productName}</span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                className="shrink-0"
              >
                <path
                  d="M9 5l7 7-7 7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
