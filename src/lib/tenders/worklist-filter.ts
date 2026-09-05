import { tenderProgresses, type TenderProgress } from "@/lib/tenders/progress";

/**
 * **How the tender list is reduced before it is read.** See ADR-0025.
 *
 * ADR-0007 built the list for a volume that no longer holds. Its reasoning is explicit
 * about the volume it assumed — *"counting is not worth a card at this volume"*, *"ten
 * Tenders across four columns is two cards a column"* — and those were right answers to
 * the question as it stood. The question changed: around fifty Tenders are live at once
 * now, and the archive behind them only grows. Fifty grouped rows is a long scroll on a
 * 390px phone, and the one a reader wants is rarely near the top.
 *
 * **This is not a search index and deliberately not SQL.** Progress and the three
 * sourcing states are *derived* on every read (ADR-0001) — nothing stores them — so a
 * `where` clause on either would mean writing that arithmetic a second time, in another
 * language, where the first copy's tests cannot see it. At fifty rows the whole list is
 * already in hand by the time the filter runs, and the filter is a predicate over rows
 * rather than a query. If the live count ever reaches a thousand this file is the wrong
 * shape and should be replaced rather than extended.
 *
 * **The filter is what the URL says; the viewer is who is asking.** The two are kept
 * apart on purpose — {@link matchesFilter} takes both — so that a filtered list is a link
 * a colleague can be sent and still means the same thing when *they* open it. Mine
 * resolves against whoever is reading, which is the one part of the state that must not
 * travel.
 */

/**
 * What the URL is asking of the list.
 *
 * Four narrowings and one widening. Each narrowing is an axis a reader can set on its
 * own or in combination; {@link revealMissed} is the odd one out and says so in its own
 * doc comment.
 */
export type WorklistFilter = {
  /**
   * Keep only Tenders that are **Mine** — owned by the reader, or assigned to them.
   *
   * One boolean rather than a whose-work axis with a named opposite. A list of fifty
   * Tenders across a team under ten has exactly one question about people worth a
   * control — *is this mine* — and the answer "no" is not a filter anybody asks for, it
   * is simply the control being off. See `CONTEXT.md`, **Mine**.
   */
  mine: boolean;
  /**
   * Free text over a Tender's reference, client and title — never its Items.
   *
   * Items are not in the list read (`TenderListItem` carries an id and an Outcome and
   * nothing else), and pulling every Item's name into it to make them searchable would
   * cost every reader a wider row so that a few can search a field they mostly do not
   * reach for. A reader who knows the product name generally knows the client too.
   */
  text: string;
  /** Which Progress values to keep. **Empty means every one** — never "none". */
  progress: TenderProgress[];
  /** Keep only Tenders with at least one Item nobody has answered for. */
  notYetSourced: boolean;
  /**
   * Show the missed submissions this filter would otherwise hide.
   *
   * **The only part of this type that widens rather than narrows**, and the reason it
   * exists is ADR-0025: the filter applies to Submission Missed like it applies to
   * everything else, the screen states how many that hid, and this is what the control
   * offering them back sets. Relaxing the narrowing axes instead would be a second Clear
   * wearing a different label, and would still leave the reader stuck when what hid the
   * rows was their search text.
   *
   * Because it widens, it is excluded from {@link isFiltering} and from
   * {@link activeView}'s comparison: a reader who reveals the missed submissions has not
   * changed which View they are reading, they have asked one pinned group to ignore it.
   */
  revealMissed: boolean;
};

/**
 * **Everything**: no narrowing at all, the whole list as it stands.
 *
 * This is the constant for callers with no reader and no query string — the digest and
 * the reminder job both read the worklist and neither has either. It is deliberately
 * *not* what a bare `/tenders` means; see {@link landingFilter}.
 */
export const everything: WorklistFilter = {
  mine: false,
  text: "",
  progress: [],
  notYetSourced: false,
  revealMissed: false,
};

/**
 * **Mine**: what a reader gets at `/tenders` before touching a control.
 *
 * With ten Tenders everybody read the whole list and a default was not a decision. With
 * fifty, most rows are somebody else's work, and a screen whose first answer to *what do
 * I do next* is everybody's Tenders has answered a different question (ADR-0025).
 *
 * The cost is that an unparameterised URL is already filtered, so the reduce bar always
 * states the View it applied rather than leaving a short list unexplained.
 */
export const landingFilter: WorklistFilter = { ...everything, mine: true };

/**
 * Is this filter narrowing anything?
 *
 * Measured against {@link everything} rather than against the landing state, so the
 * answer for a bare `/tenders` is **yes** — it is Mine, and a reader looking at a short
 * list is owed the reason it is short. This is also what tells the screen's three
 * emptinesses apart: a team who has recorded nothing, a team who has finished
 * everything, and a filter that happens to match nothing are opposite news and must
 * never read as the same sentence.
 */
export function isFiltering(filter: WorklistFilter): boolean {
  return (
    filter.mine ||
    filter.text.trim() !== "" ||
    filter.progress.length > 0 ||
    filter.notYetSourced
  );
}

/**
 * Does this row survive the filter?
 *
 * Every test is a narrowing and none of them widens, so the order they run in is a
 * performance detail and never a behaviour one. `viewerId` is null for a reader we could
 * not identify, and Mine then matches nothing rather than everything — the fail-closed
 * direction, and the same choice `ownsTender` makes for the same reason.
 *
 * {@link WorklistFilter.revealMissed} is not read here: it is a rule about one pinned
 * group, and this function is deliberately blind to which group a row landed in.
 */
export function matchesFilter(
  row: {
    reference: string;
    clientName: string;
    title: string;
    ownerUserId: string;
    assigneeUserIds: string[];
    progress: TenderProgress;
    notYetSourced: number;
  },
  filter: WorklistFilter,
  viewerId: string | null,
): boolean {
  if (filter.mine) {
    if (viewerId === null) return false;

    // Owner *or* Assignee. Both are working the Tender, and a screen that answered only
    // one of them would hide an Owner's own Tenders from them the moment somebody else
    // was assigned to source it.
    const mine = row.ownerUserId === viewerId || row.assigneeUserIds.includes(viewerId);

    if (!mine) return false;
  }

  if (filter.notYetSourced && row.notYetSourced === 0) return false;

  if (filter.progress.length > 0 && !filter.progress.includes(row.progress)) return false;

  const text = filter.text.trim().toLocaleLowerCase();

  if (text === "") return true;

  // Substring rather than word-boundary matching, because half this app's readers type
  // Han: 招标 has no spaces around it and a word-boundary test would find nothing.
  return [row.reference, row.clientName, row.title].some((field) =>
    field.toLocaleLowerCase().includes(text),
  );
}

/**
 * The URL keys, named once and **exported**, because the reduce bar's search field is a
 * `GET` form and its hidden inputs have to spell them the same way this module reads
 * them. A private copy there would be the same four strings maintained in two places,
 * free to drift the moment one is renamed.
 *
 * Stable, because these links outlive the screen that produced them — the same reasoning
 * that keeps the tender list at `/tenders` rather than at `/`. Spelled the way
 * `CONTEXT.md` spells the terms: `not_yet_sourced` is longer than `unsourced` and is the
 * name the glossary rules for.
 */
export const worklistFilterKeys = {
  mine: "mine",
  text: "q",
  progress: "progress",
  notYetSourced: "not_yet_sourced",
  revealMissed: "missed",
} as const;

/**
 * Read a filter out of `searchParams`.
 *
 * **Every unreadable value falls back to the default rather than erroring.** These
 * arrive from a URL somebody may have hand-edited or truncated in a chat client, and a
 * hand-edited link should show the reader a list, not a stack trace. The cost is that a
 * typo is silent — which is why the reduce bar always draws the state it actually
 * applied rather than echoing what was asked for.
 *
 * No params at all is {@link landingFilter}, so `mine` is read as *off only when the URL
 * says so*. That asymmetry is the whole of "Mine is the landing state": a bare
 * `/tenders` is Mine and Everything is `?mine=0`.
 */
export function parseWorklistFilter(
  params: Record<string, string | string[] | undefined>,
): WorklistFilter {
  const one = (key: string): string => {
    const value = params[key];

    // A repeated key arrives as an array. The first wins, which is arbitrary and only has
    // to be *stable* — two values for a single-valued key is a malformed link either way.
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };

  const many = (key: string): string[] => {
    const value = params[key];

    if (value === undefined) return [];

    // Both spellings, because a link may carry `?progress=new&progress=quoted` or
    // `?progress=new,quoted` depending on who built it, and both plainly mean the same.
    return (Array.isArray(value) ? value : [value]).flatMap((entry) => entry.split(","));
  };

  const progress = many(worklistFilterKeys.progress).filter(
    (entry): entry is TenderProgress =>
      (tenderProgresses as readonly string[]).includes(entry),
  );

  return {
    mine: one(worklistFilterKeys.mine) !== "0",
    // Trimmed *before* the cap, or a phone keyboard's leading space eats a character
    // off the end of what the reader typed. Cut on code points rather than UTF-16
    // units, so the hundredth character cannot be half of a surrogate pair.
    text: [...one(worklistFilterKeys.text).trim()].slice(0, 100).join(""),
    // Deduplicated, so that a doubled key cannot make the same Progress test twice.
    progress: [...new Set(progress)],
    notYetSourced: one(worklistFilterKeys.notYetSourced) === "1",
    revealMissed: one(worklistFilterKeys.revealMissed) === "1",
  };
}

/**
 * Write a filter back into a query string.
 *
 * Only what differs from the landing state is written, so the list a reader lands on is
 * a bare `/tenders` and every link is as short as it can honestly be. The keys go in a
 * fixed order rather than object order, so that the same filter is always the same
 * string and two readers comparing links are comparing the filters rather than the
 * spelling.
 */
export function worklistFilterQuery(filter: WorklistFilter): string {
  const params = new URLSearchParams();

  // The one key written for being *off*, because Mine is the default and Everything is
  // the deliberate step away from it.
  if (!filter.mine) params.set(worklistFilterKeys.mine, "0");
  if (filter.text.trim() !== "") params.set(worklistFilterKeys.text, filter.text.trim());
  if (filter.progress.length > 0) {
    // In the canonical Progress order, not the order they were clicked in.
    const ordered = tenderProgresses.filter((entry) => filter.progress.includes(entry));

    params.set(worklistFilterKeys.progress, ordered.join(","));
  }
  if (filter.notYetSourced) params.set(worklistFilterKeys.notYetSourced, "1");
  if (filter.revealMissed) params.set(worklistFilterKeys.revealMissed, "1");

  const query = params.toString();

  return query === "" ? "" : `?${query}`;
}

/**
 * A filter with one part changed, for building the link a control points at.
 *
 * Controls are links rather than client state (ADR-0025): every control on the reduce
 * bar is an `<a>` to the list with one key different, so the bar works before hydration,
 * back goes where a reader expects, and the whole state is shareable. This is what each
 * of those hrefs is computed with.
 */
export function withFilter(
  filter: WorklistFilter,
  change: Partial<WorklistFilter>,
): WorklistFilter {
  return { ...filter, ...change };
}

/**
 * A Progress toggled in or out of the filter.
 *
 * Progress is multi-select because the four values are not a scale a reader wants one
 * point of — "not started or sourcing" is the real question behind *what has nobody
 * priced yet*, and forcing a single choice would make that two visits to the screen.
 */
export function toggleProgress(
  filter: WorklistFilter,
  progress: TenderProgress,
): WorklistFilter {
  const on = filter.progress.includes(progress);

  return withFilter(filter, {
    progress: on
      ? filter.progress.filter((entry) => entry !== progress)
      : [...filter.progress, progress],
  });
}

/**
 * The four **Views**: the questions somebody asks every morning, already answered.
 *
 * These are **built in, not saved.** A saved view is a row somebody creates, names,
 * shares and eventually has to delete, and at fifty live Tenders across a team under ten
 * that is a management screen bolted onto a worklist to solve a problem nobody has. So
 * they are constants, they are the same for everybody, and each is nothing more than a
 * filter this module can already express (ADR-0025).
 *
 * **Mine is first and is where a reader lands**; the other three are one tap away and
 * each drops Mine, because two Views cannot both be true of one list and a chip that lit
 * alongside another would be saying so.
 *
 * There are no labels here. These keys are matched against `tenders.filter` and
 * `tenders.group` message ids by the screen that draws them — a module under `lib/`
 * holding message ids would be a second reason for this file to change, and the
 * **Submitted** View has no label of its own to hold: it reuses the Progress heading the
 * list already writes.
 */
export const worklistViews = [
  { key: "mine", filter: landingFilter },
  { key: "notYetSourced", filter: { ...everything, notYetSourced: true } },
  { key: "submitted", filter: { ...everything, progress: ["submitted"] } },
  { key: "everything", filter: everything },
] as const satisfies readonly { key: string; filter: WorklistFilter }[];

export type WorklistViewKey = (typeof worklistViews)[number]["key"];

/**
 * Which View, if any, the current filter *is*.
 *
 * Compared by value rather than tracked in the URL, so that a reader who arrives at a
 * View's filter by clicking the individual controls sees that View lit — the screen says
 * what is true of the list, never what route the reader took to it.
 *
 * `revealMissed` is not compared, for the reason given on the field: it widens one
 * pinned group and does not change which View is being read.
 */
export function activeView(filter: WorklistFilter): WorklistViewKey | null {
  const same = (a: WorklistFilter, b: WorklistFilter) =>
    a.mine === b.mine &&
    a.text.trim() === b.text.trim() &&
    a.notYetSourced === b.notYetSourced &&
    a.progress.length === b.progress.length &&
    a.progress.every((entry) => b.progress.includes(entry));

  return worklistViews.find((view) => same(filter, view.filter))?.key ?? null;
}
