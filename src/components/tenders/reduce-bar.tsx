import Link from "next/link";
import { useTranslations } from "next-intl";
import { Search, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tenderProgresses, type TenderProgress } from "@/lib/tenders/progress";
import {
  activeView,
  everything,
  isFiltering,
  toggleProgress,
  withFilter,
  worklistFilterKeys,
  worklistFilterQuery,
  worklistViews,
  type WorklistFilter,
  type WorklistViewKey,
} from "@/lib/tenders/worklist-filter";

/**
 * **How the tender list is narrowed before it is read.** See ADR-0025.
 *
 * At around fifty live Tenders the list stopped being something a reader scans and became
 * something they have to search. This is the control that does it, and every part of it is
 * a **link** rather than a stateful widget — which is not a stylistic preference:
 *
 * - The whole filter is in the URL, so a narrowed list is something a colleague can be
 *   sent. That is the same reasoning that keeps the list at `/tenders` rather than `/`.
 * - Nothing here needs hydration. The slowest path in the product is a Group Robot link
 *   opened at night inside the WeCom webview over a phone network (ADR-0024), and a
 *   filter bar that does not work until JavaScript arrives is a filter bar that does not
 *   work there.
 * - Back goes where a reader expects, because narrowing a list is a navigation.
 *
 * The search field is a plain `GET` form for the same reason, and it carries the rest of
 * the filter in hidden fields so that typing a client's name does not silently throw away
 * the Progress somebody had already chosen.
 *
 * **Two grains, one taxonomy.** The Views are the coarse grain and the controls under
 * *Refine* are the fine one, and they are kept in sync rather than allowed to become two
 * vocabularies — `activeView` compares by value, so a reader who assembles a View's
 * filter control by control sees that View light up. The 29 August 2026 amendment to
 * ADR-0007 is the reason this matters: the five blocks it replaced were two taxonomies
 * wearing one set of headings, and readers felt that as the screen being hard to learn.
 *
 * The fine controls are folded away in a native `<details>`, which is keyboard operable
 * and openable with no script at all. On a 390px phone the Views alone are two rows;
 * showing every control at once would push the first Tender below the fold, which is the
 * opposite of what a worklist is for.
 */
export function ReduceBar({
  filter,
  matched,
  onList,
  suppressedMissed,
}: {
  filter: WorklistFilter;
  /** How many Tenders survived the filter. */
  matched: number;
  /** How many are on the list at all — what the reader narrowed *from*. */
  onList: number;
  /** Missed submissions this filter is hiding, and refuses to hide silently. */
  suppressedMissed: number;
}) {
  const t = useTranslations("tenders.filter");
  // The four Progress names are already written, once, where the group headings read
  // them. A second copy under `filter.` would be the same word maintained in two places
  // and free to drift in one language and not the other — which is also why the
  // **Submitted** View has no label of its own.
  const group = useTranslations("tenders.group");
  const viewLabel = (key: WorklistViewKey): string =>
    key === "submitted" ? group("submitted.title") : t(key);
  const filtering = isFiltering(filter);
  const view = activeView(filter);
  const href = (next: WorklistFilter) => `/tenders${worklistFilterQuery(next)}`;
  /**
   * The fine controls unfold themselves when one of them is on and no lit View accounts
   * for it.
   *
   * A filter the reader cannot see is a filter they cannot undo — they are looking at a
   * short list with no visible reason for it being short. Where a View *is* lit the panel
   * stays folded, because the View row is already saying the same thing one grain coarser
   * and opening as well would state it twice.
   *
   * The search text is not counted: it is in a field the reader can already see. Nor is
   * `revealMissed`, which is not down here and does not narrow anything.
   */
  const refineOpen =
    view === null && (filter.mine || filter.progress.length > 0 || filter.notYetSourced);

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <SearchField
        filter={filter}
        label={t("searchLabel")}
        placeholder={t("searchPlaceholder")}
        submit={t("searchSubmit")}
      />

      {/* The coarse grain: the three or four questions somebody asks every morning. */}
      <nav aria-label={t("viewsLabel")} className="flex min-w-0 flex-wrap gap-1.5">
        {worklistViews.map((entry) => (
          <Chip
            key={entry.key}
            href={href(entry.filter)}
            on={view === entry.key}
            label={viewLabel(entry.key)}
          />
        ))}
      </nav>

      <details className="group/refine min-w-0" open={refineOpen}>
        <summary className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex min-h-11 w-fit cursor-pointer list-none items-center gap-1.5 rounded-lg px-0.5 text-[13px] font-medium outline-none focus-visible:ring-3 [&::-webkit-details-marker]:hidden">
          <SlidersHorizontal aria-hidden="true" className="size-3.5" />
          {t("refine")}
        </summary>

        <div className="flex min-w-0 flex-col gap-3 pt-1 pb-1">
          {/* The two plain yes/no narrowings, which need no legend to say what they ask. */}
          <Fieldset legend={null}>
            <Chip
              href={href(withFilter(filter, { mine: !filter.mine }))}
              on={filter.mine}
              label={t("mine")}
            />
            <Chip
              href={href(withFilter(filter, { notYetSourced: !filter.notYetSourced }))}
              on={filter.notYetSourced}
              label={t("notYetSourced")}
            />
          </Fieldset>

          <Fieldset legend={t("progressLabel")}>
            {tenderProgresses.map((progress: TenderProgress) => (
              <Chip
                key={progress}
                href={href(toggleProgress(filter, progress))}
                on={filter.progress.includes(progress)}
                label={group(`${progress}.title`)}
              />
            ))}
          </Fieldset>
        </div>
      </details>

      {/*
       * What the filter did, stated as a number rather than left to be inferred from a
       * shorter list. A reader who narrows needs to know what they narrowed *from*, or
       * the control is a thing that makes rows disappear.
       *
       * This is drawn on arrival and not only after a reader touches something, because
       * `/tenders` lands on **Mine** and an already-narrowed list that did not say so
       * would be the one case where the count matters most and is missing.
       */}
      {filtering && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-0.5">
          {/*
            A plain span rather than a component, and in the same treatment the group
            headings already give a count: `font-mono` so the digits do not shuffle as
            the number changes, `tabular-nums` so two readings of the same list line up.
          */}
          <span className="text-ink-faint shrink-0 font-mono text-[13px] font-medium tabular-nums">
            {t("showing", { matched, onList })}
          </span>
          {/* Clear is Everything, and Everything is `?mine=0` — not a bare `/tenders`,
              which is Mine and would leave the reader where they already are. */}
          <Button
            variant="ghost"
            size="sm"
            className="h-11 px-2"
            nativeButton={false}
            render={<Link href={href(everything)} prefetch={false} />}
          >
            <X aria-hidden="true" className="size-3.5" />
            {t("clear")}
          </Button>
        </div>
      )}

      {/*
       * **The one thing a filter is not allowed to bury silently.**
       *
       * ADR-0007 calls Submission Missed the failure the product exists to prevent and
       * pins it above every group so nobody has to go looking for it. Exempting it from
       * filtering was considered and rejected — a reader who asks for Mine and gets
       * somebody else's Tenders back has been told their filter does not mean what it
       * says, and that breaks every other control here. So the filter applies uniformly
       * and the screen states the cost, with the way back to them one tap away.
       *
       * **The notice stays once they are revealed**, saying the other of its two
       * sentences. Those rows do not match the filter and are on screen anyway, which is
       * a thing the reader is owed an explanation of — and if the notice vanished, the
       * only control that turns the reveal back off would go with it.
       */}
      {suppressedMissed > 0 && (
        <p className="border-alarm-edge bg-alarm-wash text-alarm-ink flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-xs leading-relaxed break-words">
          {filter.revealMissed
            ? t("revealedMissed", { count: suppressedMissed })
            : t("suppressedMissed", { count: suppressedMissed })}
          {/*
            One flag either way, and nothing else touched, so the reader keeps the search
            and the Progress they chose in both directions. Relaxing the narrowing axes
            instead would be a second Clear wearing a different label — and would still
            be a dead link when what hid the rows was the search text.

            `min-w-11` as well as `min-h-11`, and not padding: these labels are two Han
            glyphs in `zh-Hans` and one short word in `en`, so a width that came from the
            text would clear the floor in one language and miss it in the other. The 44px
            guard caught exactly that.
          */}
          <Link
            href={href(withFilter(filter, { revealMissed: !filter.revealMissed }))}
            prefetch={false}
            className="focus-visible:ring-ring inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-1 font-semibold underline underline-offset-2 outline-none focus-visible:ring-3"
          >
            {filter.revealMissed ? t("hideMissed") : t("showMissed")}
          </Link>
        </p>
      )}
    </div>
  );
}

/**
 * The search field, as a `GET` form that works before hydration.
 *
 * The rest of the filter rides along in hidden fields. Without them, typing a client's
 * name would quietly clear the Progress a reader had already chosen — the form submits
 * what it contains, and what it does not contain is what it drops.
 *
 * Those fields are **read off the query string this filter would otherwise produce**,
 * rather than spelled out here. Two things follow that are worth having: the key names
 * cannot drift from the ones `parseWorklistFilter` reads, and a submitted search lands on
 * the same canonical Progress order every chip link uses — so the URL a reader gets by
 * typing and the one they get by tapping are the same string, not two spellings of one
 * filter.
 */
function SearchField({
  filter,
  label,
  placeholder,
  submit,
}: {
  filter: WorklistFilter;
  label: string;
  placeholder: string;
  submit: string;
}) {
  const carried = new URLSearchParams(worklistFilterQuery(filter).slice(1));

  // Everything except the text, which is what the visible input is for.
  carried.delete(worklistFilterKeys.text);

  return (
    <form method="get" action="/tenders" className="flex min-w-0 items-center gap-1.5">
      {[...carried].map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <div className="relative min-w-0 flex-1">
        <Search
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        {/*
          `key` on an uncontrolled input, which looks odd and is the point. Every other
          control here is a soft navigation that re-renders this same DOM node, and React
          writes `defaultValue` to the attribute only — so without a remount the box goes
          on showing text the list is no longer filtered by. A reader who typed "gloves",
          tapped Clear, then pressed Search again would re-apply a filter they had just
          watched themselves clear.
        */}
        <Input
          key={filter.text}
          type="search"
          name={worklistFilterKeys.text}
          defaultValue={filter.text}
          aria-label={label}
          placeholder={placeholder}
          className="h-11 pl-9"
        />
      </div>
      <Button type="submit" size="sm" variant="outline" className="h-11 shrink-0 px-3">
        {submit}
      </Button>
    </form>
  );
}

/** A labelled row of chips that wraps. Never a clipped single row — see ADR-0025. */
function Fieldset({
  legend,
  children,
}: {
  legend: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {legend !== null && (
        <span className="text-ink-faint px-0.5 text-[11px] font-medium tracking-wide uppercase">
          {legend}
        </span>
      )}
      <div className="flex min-w-0 flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/**
 * One filter control: a link that reads as a toggle.
 *
 * `aria-current` rather than `aria-pressed`, because this is a navigation and not a
 * button — following it changes which list you are looking at. The lit state is carried
 * by fill and weight as well as by the attribute, so it does not rely on colour alone.
 */
function Chip({ href, on, label }: { href: string; on: boolean; label: string }) {
  return (
    <Button
      variant={on ? "default" : "outline"}
      size="sm"
      className="h-11 px-3 text-[13px] font-medium whitespace-normal"
      nativeButton={false}
      render={
        <Link href={href} prefetch={false} aria-current={on ? "true" : undefined}>
          {label}
        </Link>
      }
    />
  );
}
