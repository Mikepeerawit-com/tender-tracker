"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * One Tender Item's row, and the ranked Quotes underneath it.
 *
 * **Openness is derived, not remembered.** `derivedOpen` is computed on every render from
 * whether the Item has a Selected Quote, so the page opens showing exactly the work that
 * is left: undecided Items expanded, decided ones folded away. Nothing about which Items
 * were open is persisted anywhere, which is why there is no effect here syncing state
 * back to a server.
 *
 * The twisty overrides that **for this visit only**, and it is the *only* thing that
 * does. State here holds the override rather than the openness, so an Item nobody has
 * touched the twisty on keeps following the derivation on every render — which is what
 * makes choosing a Quote fold the Item away, the sheet's way of saying that piece of work
 * is done. An Item somebody did open by hand stays as they left it, including after they
 * select on it.
 *
 * `useState` rather than a stored preference, on purpose: a person opens a decided Item to
 * check a price they remember, and on their next visit the page should again be about the
 * work outstanding rather than about what they happened to poke at last week.
 *
 * Both halves are rendered on the server and passed in — the summary cells and the panel
 * carry formatted money, translated banners and signed photo URLs, none of which belong
 * in a client component. All this owns is whether the panel is in the tree.
 */
export function ItemDisclosure({
  itemId,
  derivedOpen,
  openLabel,
  foldLabel,
  columns,
  summary,
  panel,
}: {
  itemId: string;
  /** Recomputed by the caller on every render: has this Item still no Selected Quote? */
  derivedOpen: boolean;
  openLabel: string;
  foldLabel: string;
  /** How many cells the panel spans, so it stays a full-width row under the Item. */
  columns: number;
  /** The Item's own cells, minus the twisty's — a fragment of `<td>`s. */
  summary: ReactNode;
  panel: ReactNode;
}) {
  const [override, setOverride] = useState<boolean | undefined>(undefined);
  const open = override ?? derivedOpen;
  const panelId = `item-quotes-${itemId}`;

  return (
    <>
      <tr className={open ? "" : "text-muted-foreground"}>
        <td className="border-border border-t px-2 py-3 align-top">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={open ? foldLabel : openLabel}
            className="hover:bg-muted focus-visible:ring-ring/50 inline-flex size-11 items-center justify-center rounded-lg focus-visible:ring-3 focus-visible:outline-none"
            onClick={() => setOverride(!open)}
          >
            {open ? (
              <ChevronDown className="size-4" aria-hidden />
            ) : (
              <ChevronRight className="size-4" aria-hidden />
            )}
          </button>
        </td>
        {summary}
      </tr>

      {open ? (
        <tr id={panelId}>
          <td colSpan={columns} className="bg-muted/40 px-3 py-4">
            {panel}
          </td>
        </tr>
      ) : null}
    </>
  );
}
