import { useTranslations } from "next-intl";

import { TenderRow } from "@/components/tenders/tender-row";
import { IndicatorLamp } from "@/components/ui/indicator-lamp";
import { tenderProgresses, type WorklistGroup } from "@/lib/tenders/progress";
import type { WorklistSection } from "@/lib/tenders/worklist";

/**
 * One group of the worklist: its heading, and the rows under it.
 *
 * Two shapes, because the groups are not peers. The four Progress groups are a plain
 * heading — name, journey scale, count — over a bordered list. **Submission Missed is
 * drawn as an alarm band** and pinned above them, because it is the failure the product
 * exists to prevent: a dead Tender rendered as one more row inside "Sourcing" with a
 * small red mark is precisely the outcome the old block was invented to stop, and it
 * would be exactly that if the pinned group looked like the others.
 *
 * An empty group draws nothing. `listWorklist` returns all five in order regardless —
 * the ordering is its decision and a caller reassembling it could get it wrong — but four
 * empty headings on a 390px phone is a third of the screen spent saying nothing.
 *
 * Sync, and taking only what it draws, for the reason `vitest.config.mts` gives: the page
 * is an `async` Server Component behind `currentUser` and is reachable by no browser test,
 * so this is the seam `screens.layout.test.tsx` measures instead.
 */
export function TenderGroup({ section }: { section: WorklistSection }) {
  const t = useTranslations("tenders");

  if (section.tenders.length === 0) return null;

  const heading = t(`group.${section.group}.title`);
  const hint = t(`group.${section.group}.hint`);
  const rows = (
    <ul className="flex min-w-0 flex-col">
      {section.tenders.map((tender, index) => (
        <li
          key={tender.id}
          className={index === 0 ? "min-w-0" : "border-hairline-soft min-w-0 border-t"}
        >
          <TenderRow tender={tender} />
        </li>
      ))}
    </ul>
  );

  if (section.group === "submission_missed") {
    return (
      <section className="border-alarm-edge border-alarm min-w-0 overflow-hidden rounded-lg border border-t-2">
        <div className="bg-alarm-wash flex min-w-0 flex-col gap-1 px-3.5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <IndicatorLamp tone="alarm" size={15} />
            <h2 className="text-alarm-ink min-w-0 text-[13px] font-semibold break-words">
              {heading}
            </h2>
            <span className="text-alarm-ink ml-auto shrink-0 font-mono text-[13px] font-medium">
              {section.tenders.length}
            </span>
          </div>
          <p className="text-alarm-ink/85 min-w-0 text-xs leading-relaxed break-words">
            {hint}
          </p>
        </div>
        <div className="border-alarm-edge bg-card min-w-0 border-t">{rows}</div>
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2.5 px-0.5">
          <h2 className="min-w-0 text-[13px] font-semibold break-words">{heading}</h2>
          <ProgressScale group={section.group} />
          <span className="text-ink-faint ml-auto shrink-0 font-mono text-[13px] font-medium">
            {section.tenders.length}
          </span>
        </div>
        <p className="text-muted-foreground min-w-0 px-0.5 text-xs leading-relaxed break-words">
          {hint}
        </p>
      </div>
      <div className="border-hairline bg-card min-w-0 overflow-hidden rounded-lg border">
        {rows}
      </div>
    </section>
  );
}

/**
 * Where in the journey this group sits: four segments, lit up to and including this one.
 *
 * Four because Progress has four values, and it is drawn as a **read-only scale rather
 * than a board** on purpose. A kanban board was considered and rejected: Progress is
 * derived and never stored (ADR-0001), so a card cannot be dragged between columns — the
 * one gesture a board exists to offer is the one this domain cannot honour. This is what
 * was kept from the idea. The movement is legible; nothing invites you to drag it.
 *
 * On the heading, never on the row: inside a group every row has the same Progress, so a
 * per-row scale would repeat the heading on every line.
 *
 * `aria-hidden`, because the heading beside it already names the Progress in words. The
 * scale is emphasis, not a second copy of the fact.
 */
function ProgressScale({ group }: { group: WorklistGroup }) {
  const reached = tenderProgresses.indexOf(group as (typeof tenderProgresses)[number]);

  return (
    <span className="flex shrink-0 gap-0.5" aria-hidden="true">
      {tenderProgresses.map((progress, index) => (
        <span
          key={progress}
          className={`h-[3px] w-[11px] rounded-[1px] ${
            index <= reached ? "bg-signal" : "bg-border"
          }`}
        />
      ))}
    </span>
  );
}
