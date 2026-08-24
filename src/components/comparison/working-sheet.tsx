import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { ItemDisclosure } from "@/components/comparison/item-disclosure";
import { SelectQuoteButton } from "@/components/comparison/select-quote-button";
import { ImageCountBadge } from "@/components/images/image-count-badge";
import { Button } from "@/components/ui/button";
import { calendarDate, calendarDateFormat } from "@/lib/calendar-date";
import {
  itemBanners,
  itemsNeedingDecision,
  needsDecision,
  rankQuotes,
  type ItemBanner,
  type RankedQuote,
} from "@/lib/comparison/ranking";
import type { SheetItem } from "@/lib/comparison/sheet";
import type { ReferenceImage } from "@/lib/images/reference-images";
import type { QuotePhoto } from "@/lib/images/quote-photos";
import { reportingCurrency, type ItemSourcing, type Quote } from "@/lib/quotes/quotes";

/**
 * The comparison working sheet — the densest screen in v1, at desktop width.
 *
 * The whole Tender on one page: one row per Tender Item and, under the ones still needing
 * a decision, every competing Quote ranked cheapest-first in THB so eight prices can be
 * read down a column of numbers instead of compared by eye. Cards were built and measured
 * against this and lost decisively here, collapsing at around four of the eight competing
 * Quotes ADR-0004's compete-not-divide model makes normal; below 768px the density
 * argument runs the other way and the quote table reflows into those same cards
 * (ADR-0009, #30). One responsive design and one component tree — this is its table
 * branch, not a desktop layout with a phone twin waiting to be written beside it.
 *
 * Two rules run through everything below.
 *
 * **Openness is derived, not remembered.** Nothing stores which Items were expanded. An
 * Item with no Selected Quote opens; a decided one folds; the header says how many are
 * left, so the page opens showing exactly the work outstanding.
 *
 * **Being loudly unhelpful beats being quietly wrong.** The banners stack above the quote
 * table and never sit on rows, and the first of them refuses to rank the Item at all. A
 * sheet that silently divided "box of 50" by fifty to get a comparable price would not
 * look broken — it would look authoritative, and send somebody to the wrong supplier.
 */
/** The twisty, plus Item · Selected Quote · landed cost · selling · margin · margin on line. */
const sheetColumns = 7;

export async function WorkingSheet({
  tenderId,
  items,
  photos,
  referenceImages,
}: {
  tenderId: string;
  items: SheetItem[];
  /** Every Quote's photos on the Tender, keyed by Quote — one query for the whole page. */
  photos: Map<string, QuotePhoto[]>;
  referenceImages: ReferenceImage[];
}) {
  const t = await getTranslations("comparison");
  const undecided = itemsNeedingDecision(items);

  return (
    <section className="flex flex-col gap-4">
      {/* "2 of 4 Items still need a Quote selected" — the sentence that tells somebody
          landing here what the page is currently about. */}
      <div className="border-border bg-muted/40 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border px-4 py-3">
        <span className="text-sm font-medium">
          {undecided === 0
            ? t("header.allDecided")
            : t("header.undecided", { count: undecided, total: items.length })}
        </span>
        <span className="text-muted-foreground text-sm">
          {undecided === 0 ? t("header.allDecidedRest") : t("header.undecidedRest")}
        </span>
      </div>

      <div className="border-border rounded-lg border">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="text-muted-foreground text-left text-xs">
              <th className="w-10 px-2 py-2" />
              <th className="px-2 py-2 font-medium">{t("column.item")}</th>
              <th className="px-2 py-2 font-medium">{t("column.selectedQuote")}</th>
              <th className="w-32 px-2 py-2 text-right font-medium">
                {t("column.landedCost")}
              </th>
              <th className="w-28 px-2 py-2 text-right font-medium">
                {t("column.selling")}
              </th>
              <th className="w-28 px-2 py-2 text-right font-medium">
                {t("column.marginPerUnit")}
              </th>
              <th className="w-32 px-2 py-2 text-right font-medium">
                {t("column.marginOnLine")}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <ItemDisclosure
                key={item.id}
                itemId={item.id}
                // Recomputed here on every render, never read back from anywhere.
                derivedOpen={needsDecision(item)}
                openLabel={t("twisty.open", { item: item.productName })}
                foldLabel={t("twisty.fold", { item: item.productName })}
                columns={sheetColumns}
                summary={<ItemCells tenderId={tenderId} item={item} />}
                panel={
                  <ItemPanel
                    tenderId={tenderId}
                    item={item}
                    photos={photos}
                    referenceImages={referenceImages.filter(
                      (image) => image.tenderItemId === item.id,
                    )}
                  />
                }
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-muted-foreground text-xs">{t("derivedNote")}</p>
    </section>
  );
}

async function ItemCells({ tenderId, item }: { tenderId: string; item: SheetItem }) {
  const t = await getTranslations("comparison");
  const tq = await getTranslations("quotes");
  // The Tender's own sourcing vocabulary, not the sheet's: these three states are facts
  // about an Item and are named the same wherever an Item is shown.
  const ts = await getTranslations("tenders.sourcing");
  const format = await getFormatter();
  const selected = item.quotes.find((quote) => quote.id === item.selectedQuoteId);
  const margin = marginOf(item);

  const thb = (amount: number) =>
    format.number(amount, { style: "currency", currency: reportingCurrency });

  return (
    <>
      <td className="border-border border-t px-2 py-3 align-top">
        <div className="flex flex-col items-start gap-1.5">
          <span className="text-foreground font-medium">{item.productName}</span>
          <span className="text-muted-foreground text-xs">
            {t("item.quantified", {
              quantity: item.quantity,
              unit: item.unit,
              quotes: item.quotes.length,
            })}
          </span>

          {/* The three sourcing states. The difference between the last two decides
              whether it is worth waiting before bidding: an Item nobody has touched
              means different work from one somebody has already given up on. */}
          <SourcingChips sourcing={item.sourcing} />

          <Button
            variant="ghost"
            size="sm"
            className="h-11 px-2"
            nativeButton={false}
            render={<Link href={`/tenders/${tenderId}/items/${item.id}/quote`} />}
          >
            {ts("source")}
          </Button>
        </div>
      </td>

      <td className="border-border border-t px-2 py-3 align-top">
        {selected ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-foreground font-medium">{selected.supplierName}</span>
            <span className="text-muted-foreground text-xs">
              {format.number(selected.unitPrice, {
                style: "currency",
                currency: selected.currency,
              })}{" "}
              {tq("perUnit", { unit: selected.quotedUnit })}
            </span>
            <span className="text-muted-foreground text-xs">
              {tq("sourcedBy", { name: selected.sourcedByName })}
            </span>
          </div>
        ) : (
          <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
            {t("needsDecision")}
          </span>
        )}
      </td>

      {/* Read-only here. Landed cost pre-filling from the Selected Quote and both figures
          becoming editable inline is #28, which also owns the totals bar beneath. */}
      <td className="border-border text-muted-foreground border-t px-2 py-3 text-right align-top tabular-nums">
        {item.landedCostPerUnit === null ? emDash : thb(item.landedCostPerUnit)}
      </td>
      <td className="border-border text-muted-foreground border-t px-2 py-3 text-right align-top tabular-nums">
        {item.sellingPricePerUnit === null ? emDash : thb(item.sellingPricePerUnit)}
      </td>
      <td className="border-border border-t px-2 py-3 text-right align-top tabular-nums">
        <Margin value={margin?.perUnit ?? null} provisional={margin?.provisional ?? false} />
      </td>
      <td className="border-border border-t px-2 py-3 text-right align-top tabular-nums">
        <Margin value={margin?.onLine ?? null} provisional={margin?.provisional ?? false} />
      </td>
    </>
  );
}

/**
 * Margin, or the honest absence of one.
 *
 * Never stored: it is selling price minus Landed Cost, and a stored copy would be a third
 * number to keep in step with two that already move. A Margin derived from an
 * **Unconfirmed** Landed Cost — one still sitting at its pre-filled value, with nothing
 * added for shipping, duty or handling — is understated in cost and overstated in profit,
 * so it renders as provisional rather than as a number. Nothing is blocked and nobody is
 * nagged; the figure simply stops pretending to be final.
 */
async function Margin({
  value,
  provisional,
}: {
  value: number | null;
  provisional: boolean;
}) {
  const t = await getTranslations("comparison");
  const format = await getFormatter();

  if (value === null) return <span className="text-muted-foreground">{emDash}</span>;

  if (provisional) {
    return <span className="text-muted-foreground text-xs">{t("provisional")}</span>;
  }

  return (
    <span className={value < 0 ? "text-destructive font-medium" : "font-medium"}>
      {format.number(value, { style: "currency", currency: reportingCurrency })}
    </span>
  );
}

/** Everything under the twisty: the client's pictures, the banners, then the ranked Quotes. */
async function ItemPanel({
  tenderId,
  item,
  photos,
  referenceImages,
}: {
  tenderId: string;
  item: SheetItem;
  photos: Map<string, QuotePhoto[]>;
  referenceImages: ReferenceImage[];
}) {
  const t = await getTranslations("comparison");
  const ranked = rankQuotes(item, item.quotes);
  const banners = itemBanners(item, item.quotes);

  return (
    <div className="flex flex-col gap-3">
      {/* What the *client* sent, at the top of the panel and so within a glance of the
          Quote Photos column it exists to be compared against — which on an Alternative is
          often the only way to judge how far the substitute really is. A count opening a
          lightbox, never thumbnails: strips were measured eating the horizontal room the
          money columns need. */}
      {referenceImages.length > 0 ? (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {t("referenceImages.label")}
          </span>
          <ImageCountBadge
            openLabel={t("referenceImages.open", {
              item: item.productName,
              count: referenceImages.length,
            })}
            images={referenceImages}
          />
        </div>
      ) : null}

      {/* Item-level, stacked, and never on a row. Two of the three are statements about
          the ranking, which is a property of the Item and not of any one supplier. */}
      {banners.map((banner, index) => (
        <Banner key={`${banner.kind}-${index}`} banner={banner} item={item} />
      ))}

      {ranked.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noQuotes")}</p>
      ) : (
        <QuoteTable
          tenderId={tenderId}
          item={item}
          ranked={ranked}
          photos={photos}
        />
      )}
    </div>
  );
}

async function QuoteTable({
  tenderId,
  item,
  ranked,
  photos,
}: {
  tenderId: string;
  item: SheetItem;
  ranked: RankedQuote<Quote>[];
  photos: Map<string, QuotePhoto[]>;
}) {
  const t = await getTranslations("comparison");

  return (
    <div className="border-border bg-background overflow-hidden rounded-lg border">
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="text-muted-foreground border-border border-b text-left text-xs">
            <th className="w-8 px-2 py-2 font-medium">{t("quote.rank")}</th>
            <th className="px-2 py-2 font-medium">{t("quote.supplier")}</th>
            {/* Never dropped. With the same supplier legitimately quoted twice it is the
                only thing distinguishing two otherwise identical rows (ADR-0004). */}
            <th className="w-36 px-2 py-2 font-medium">{t("quote.sourcedBy")}</th>
            <th className="w-48 px-2 py-2 font-medium">{t("quote.quotedProduct")}</th>
            <th className="w-40 px-2 py-2 text-right font-medium">
              {t("quote.unitPrice")}
            </th>
            <th className="w-36 px-2 py-2 text-right font-medium">
              {t("quote.lineTotal", { quantity: item.quantity, unit: item.unit })}
            </th>
            <th className="w-20 px-2 py-2 font-medium">{t("quote.photos")}</th>
            <th className="w-28 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {ranked.map((row) => (
            <QuoteRow
              key={row.quote.id}
              tenderId={tenderId}
              item={item}
              row={row}
              photos={photos.get(row.quote.id) ?? []}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function QuoteRow({
  tenderId,
  item,
  row,
  photos,
}: {
  tenderId: string;
  item: SheetItem;
  row: RankedQuote<Quote>;
  photos: QuotePhoto[];
}) {
  const t = await getTranslations("comparison");
  const tq = await getTranslations("quotes");
  const format = await getFormatter();
  const { quote } = row;
  const isSelected = item.selectedQuoteId === quote.id;
  const isAlternative = quote.matchType === "alternative";

  // The rate and the day it was published, on hover — it belongs within reach of the
  // converted figure and nowhere near the width the money columns need. Repeated into the
  // accessible name, because a `title` is mouse-only and this figure is the whole basis of
  // the ranking the row is claiming.
  const rateTitle = tq("atRate", {
    rate: format.number(quote.fxRateApplied, { maximumFractionDigits: 4 }),
    date: format.dateTime(calendarDate(quote.fxRateAsOf), calendarDateFormat),
  });

  return (
    <tr
      className={[
        "border-border border-t align-top",
        // Amber, because this row is not a price for what was asked for.
        isAlternative ? "bg-amber-500/5" : "",
        isSelected ? "bg-primary/5" : "",
      ].join(" ")}
    >
      <td className="text-muted-foreground px-2 py-3 tabular-nums">
        {/* No number at all on an Item something refuses to rank — not a greyed one, not
            a dash pretending to be one. */}
        {row.rank ?? "·"}
      </td>

      <td className="px-2 py-3 font-medium">{quote.supplierName}</td>

      <td className="text-muted-foreground px-2 py-3 text-xs">{quote.sourcedByName}</td>

      <td className="px-2 py-3">
        {isAlternative ? (
          <div className="flex flex-col gap-1">
            <span className="w-fit rounded bg-amber-500/20 px-1.5 py-0.5 text-[0.7rem] font-medium tracking-wide uppercase">
              {tq("matchType.alternative")}
            </span>
            <span className="font-medium">{quote.alternativeProductName}</span>
            <span className="text-muted-foreground text-xs">
              {t("quote.requested", { product: item.productName })}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">{t("quote.asRequested")}</span>
        )}
      </td>

      <td className="px-2 py-3 text-right tabular-nums">
        <div className="flex flex-col items-end gap-0.5">
          {/* The supplier's own amount is the real one and is primary and bold. The THB
              figure beneath it is ours, derived, and says so with an `≈`. */}
          <span className="font-semibold">
            {format.number(quote.unitPrice, {
              style: "currency",
              currency: quote.currency,
            })}
          </span>

          {quote.currency === reportingCurrency ? null : (
            <span className="text-muted-foreground text-xs" title={rateTitle}>
              <span className="sr-only">{rateTitle}</span>
              {tq("approx", {
                amount: format.number(quote.unitPriceThb, {
                  style: "currency",
                  currency: reportingCurrency,
                }),
              })}
              {quote.fxRateIsStale ? (
                <span className="ml-1 rounded bg-amber-500/20 px-1 py-0.5 text-[0.65rem]">
                  {tq("staleRate")}
                </span>
              ) : null}
            </span>
          )}

          <span className="text-muted-foreground text-xs">
            {tq("perUnit", { unit: quote.quotedUnit })}
          </span>

          {/* "lowest", never "cheapest": the row is highlighted, not stamped. Absent
              entirely from an Item that cannot be ranked. */}
          {row.isLowest ? (
            <span className="w-fit rounded bg-emerald-500/20 px-1.5 py-0.5 text-[0.7rem] font-medium">
              {t("quote.lowest")}
            </span>
          ) : null}
        </div>
      </td>

      <td className="px-2 py-3 text-right tabular-nums">
        {row.lineTotalThb === null ? (
          // The Quote is priced in a unit the Item is not counted in. A total here would
          // be out by whatever the pack size is.
          <span className="text-muted-foreground text-xs">{t("quote.notComparable")}</span>
        ) : (
          <span>
            {format.number(row.lineTotalThb, {
              style: "currency",
              currency: reportingCurrency,
              maximumFractionDigits: 0,
            })}
          </span>
        )}
      </td>

      <td className="px-2 py-3">
        {/* A count opening a lightbox, never thumbnails. On an Alternative the photo is
            often the only way to judge how far the substitute really is. */}
        <ImageCountBadge
          openLabel={t("quote.openPhotos", {
            supplier: quote.supplierName,
            count: photos.length,
          })}
          images={photos}
        />
      </td>

      <td className="px-2 py-3">
        <SelectQuoteButton
          tenderId={tenderId}
          tenderItemId={item.id}
          quoteId={quote.id}
          isSelected={isSelected}
        />
      </td>
    </tr>
  );
}

async function Banner({ banner, item }: { banner: ItemBanner; item: SheetItem }) {
  const t = await getTranslations("comparison.banner");
  const format = await getFormatter();

  if (banner.kind === "unit_mismatch") {
    return (
      <Notice tone="stop" title={t("unitMismatch.title")}>
        {t("unitMismatch.body", { unit: item.unit })}
      </Notice>
    );
  }

  if (banner.kind === "all_alternatives") {
    return (
      <Notice tone="warn" title={t("allAlternatives.title")}>
        {t("allAlternatives.body", {
          count: banner.quoteCount,
          product: item.productName,
        })}
      </Notice>
    );
  }

  if (banner.kind === "too_close_to_call") {
    return (
      <Notice tone="warn" title={t("tooClose.title")}>
        {t("tooClose.body", {
          leader: banner.leader,
          runnerUp: banner.runnerUp,
          gap: format.number(banner.gapPct, { maximumFractionDigits: 1 }),
          supplier: banner.staleSupplier,
          date: format.dateTime(calendarDate(banner.staleAsOf), calendarDateFormat),
        })}
      </Notice>
    );
  }

  return (
    <Notice tone="info" title={t("duplicateSupplier.title")}>
      {t("duplicateSupplier.body", {
        supplier: banner.supplier,
        prices: banner.quotes
          .map((quote) =>
            t("duplicateSupplier.price", {
              amount: format.number(quote.unitPrice, {
                style: "currency",
                currency: quote.currency,
              }),
              name: quote.sourcedByName,
            }),
          )
          .join(t("duplicateSupplier.and")),
      })}
    </Notice>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: "stop" | "warn" | "info";
  title: string;
  children: string;
}) {
  const tones = {
    stop: "border-destructive/40 bg-destructive/10 text-destructive",
    warn: "border-amber-500/40 bg-amber-500/10",
    info: "border-border bg-background",
  };

  return (
    <p role="note" className={`rounded-lg border px-3 py-2 text-sm ${tones[tone]}`}>
      <span className="font-semibold">{title}</span> <span>{children}</span>
    </p>
  );
}

/**
 * Which of the three sourcing states this Item is in.
 *
 * Not Yet Sourced is the *absence* of the other two, which is why it is read off an empty
 * sourcing record rather than stored: an Item with a Quote and an Item somebody has given
 * up on have both been answered, and only the untouched one is overdue.
 */
async function SourcingChips({ sourcing }: { sourcing: ItemSourcing }) {
  const t = await getTranslations("tenders.sourcing");
  const refusals = sourcing.noSupplierFound.length;

  if (sourcing.quoteCount === 0 && refusals === 0) {
    return (
      <span className="bg-muted text-muted-foreground w-fit rounded px-2 py-0.5 text-xs">
        {t("notYetSourced")}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {sourcing.quoteCount > 0 ? (
        <span className="bg-primary/10 text-foreground w-fit rounded px-2 py-0.5 text-xs">
          {t("quoted", { count: sourcing.quoteCount })}
        </span>
      ) : null}
      {refusals > 0 ? (
        <span className="text-foreground w-fit rounded bg-amber-500/20 px-2 py-0.5 text-xs">
          {t("noSupplierFound", { count: refusals })}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Margin per unit and on the line, or null when there is nothing honest to show.
 *
 * `landed_cost_confirmed_at` is what makes it a number. Inferring "untouched" by
 * comparing the cost against the frozen Quote price breaks the moment shipping is
 * genuinely zero, so it is not done that way.
 */
function marginOf(
  item: SheetItem,
): { perUnit: number; onLine: number; provisional: boolean } | null {
  if (item.landedCostPerUnit === null || item.sellingPricePerUnit === null) return null;

  const perUnit = item.sellingPricePerUnit - item.landedCostPerUnit;

  return {
    perUnit,
    onLine: perUnit * item.quantity,
    provisional: item.landedCostConfirmedAt === null,
  };
}

const emDash = "—";
