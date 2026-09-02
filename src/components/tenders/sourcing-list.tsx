import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import { ImageCountBadge } from "@/components/images/image-count-badge";
import { Button } from "@/components/ui/button";
import type { QuotePhoto } from "@/lib/images/quote-photos";
import type { ReferenceImage } from "@/lib/images/reference-images";
import type { Quote } from "@/lib/quotes/quotes";
import type { AssigneeItem } from "@/lib/tenders/tender-screen";

/**
 * The Tender detail for somebody who does not own it: the Items, and their own work on
 * them.
 *
 * What stands where the comparison sheet stands on the Owner's screen (ADR-0020, #92).
 * The sheet is a nine-column ranked table with two auto-saving money inputs on every row,
 * and none of it is an Assignee's job — their job is to get prices from their own
 * suppliers and write them down, which happens one Item at a time on the sourcing screen
 * this links to. So this is a list of what there is to source and what you have found,
 * and it is roughly a tenth of the controls.
 *
 * **It cannot draw what it is not given, and it is not given much.** Every Quote here is
 * this reader's own and every refusal is their own, because `loadTenderScreen` narrowed
 * them before this component existed in the render. There is no `isOwner` prop and
 * nothing here asks who is looking: a component that had to remember to check is a
 * component that can forget.
 *
 * One design at every width, like everything else since ADR-0009: each Item is a block
 * whose parts wrap, so it holds at 390px and at 1280px without knowing which it is in.
 * There is no table to reflow, which is the whole of why this screen is the easy one.
 */
export function SourcingList({
  tenderId,
  items,
  photos,
  referenceImages,
}: {
  tenderId: string;
  items: AssigneeItem[];
  /** This reader's own Quotes' photos, keyed by Quote. */
  photos: Map<string, QuotePhoto[]>;
  referenceImages: ReferenceImage[];
}) {
  const t = useTranslations("tenders.yourItems");

  return (
    <section className="flex flex-col gap-4">
      <div className="border-border bg-muted/40 flex flex-col gap-1 rounded-lg border px-4 py-3">
        <span className="text-sm font-medium">{t("title")}</span>
        {/* Says what is missing and whose it is, rather than leaving somebody who has
            seen the Owner's screen wondering what broke. */}
        <span className="text-muted-foreground text-sm">{t("hint")}</span>
      </div>

      <ul className="border-border divide-border divide-y rounded-lg border text-sm">
        {items.map((item) => (
          <li key={item.id} className="flex min-w-0 flex-col gap-2 p-4">
            <Item
              tenderId={tenderId}
              item={item}
              photos={photos}
              referenceImages={referenceImages.filter(
                (image) => image.tenderItemId === item.id,
              )}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Item({
  tenderId,
  item,
  photos,
  referenceImages,
}: {
  tenderId: string;
  item: AssigneeItem;
  photos: Map<string, QuotePhoto[]>;
  referenceImages: ReferenceImage[];
}) {
  const t = useTranslations("tenders.yourItems");
  const ti = useTranslations("tenders.item");
  const ts = useTranslations("tenders.sourcing");
  const tr = useTranslations("tenders.referenceImages");

  return (
    <>
      {/* `break-words` and not a truncation: a client's product name arrives as one
          unbroken 50-character string often enough that the tender list's own fixtures
          are made of them, and ADR-0009's failure bar is that nothing scrolls sideways at
          390px. A name that wraps mid-word is readable; one that pushes the page is not. */}
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-foreground min-w-0 font-medium break-words">
          {item.productName}
        </span>
        <span className="text-muted-foreground text-xs">
          {ti("quantified", { quantity: item.quantity, unit: item.unit })}
        </span>
      </div>

      {/* What the *client* sent, which is what an Assignee shows their supplier. A count
          opening a lightbox, never thumbnails — the same badge the sheet uses, for the
          reason `ImageCountBadge` gives. */}
      {referenceImages.length > 0 ? (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">{tr("title")}</span>
          <ImageCountBadge
            openLabel={tr("openCount", {
              label: item.productName,
              count: referenceImages.length,
            })}
            images={referenceImages}
          />
        </div>
      ) : null}

      {item.yourQuotes.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="field-label">{t("yourQuotes")}</span>
          <ul className="flex flex-col gap-1.5">
            {item.yourQuotes.map((quote) => (
              <YourQuote
                key={quote.id}
                quote={quote}
                photos={photos.get(quote.id) ?? []}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {/* Stated in the first person, as something this reader did — the label rule
          `CONTEXT.md` gives for No Supplier Found, and the same wording the sourcing
          screen uses so the two screens do not describe one record two ways. */}
      {item.yourNoSupplierFound ? (
        <p className="text-muted-foreground text-xs">
          <NoSupplierFoundLine note={item.yourNoSupplierFound.note} />
        </p>
      ) : null}

      {item.yourQuotes.length === 0 && item.yourNoSupplierFound === null ? (
        <span className="bg-muted text-muted-foreground w-fit max-w-full rounded px-2 py-0.5 text-xs">
          {ts("notYetSourced")}
        </span>
      ) : null}

      <Button
        variant="outline"
        size="sm"
        className="h-11 w-fit"
        nativeButton={false}
        render={
          <Link href={`/tenders/${tenderId}/items/${item.id}/quote`} prefetch={false} />
        }
      >
        {ts("source")}
      </Button>
    </>
  );
}

/** One of this reader's own Quotes: the supplier, the price they were given, the photos. */
function YourQuote({ quote, photos }: { quote: Quote; photos: QuotePhoto[] }) {
  const tq = useTranslations("quotes");
  const format = useFormatter();

  return (
    <li className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-foreground min-w-0 font-medium break-words">
        {quote.supplierName}
      </span>
      {/* The price *as the supplier gave it* — their currency and their unit, never
          converted. The THB conversion exists to rank Quotes against each other, which is
          the Owner's act and is not on this screen at all. */}
      <span className="text-muted-foreground text-xs">
        <span className="money text-foreground text-base font-medium">
          {format.number(quote.unitPrice, {
            style: "currency",
            currency: quote.currency,
          })}
        </span>{" "}
        {tq("perUnit", { unit: quote.quotedUnit })}
      </span>
      <ImageCountBadge
        openLabel={tq("photos.openCount", { count: photos.length })}
        images={photos}
      />
    </li>
  );
}

function NoSupplierFoundLine({ note }: { note: string | null }) {
  const t = useTranslations("quotes.noSupplier");

  return <>{note === null ? t("mine") : t("mineWithNote", { note })}</>;
}
