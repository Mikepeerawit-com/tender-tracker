import Link from "next/link";
import { useTranslations } from "next-intl";

import { AppMenu } from "@/components/app-menu";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";

/**
 * Where the reader is. One of two shapes, and never more than one row.
 *
 * `app` is the wordmark, and is what every screen that is not about one record gets.
 * `record` is a back control plus the record's own identity — the reference and client
 * name on a Tender, those and the Item on the sourcing screen — composed by the page,
 * which is the only thing that knows them.
 */
export type AppLocation =
  | { kind: "app" }
  | {
      kind: "record";
      /** Where the back control goes: the list from a Tender, the Tender from an Item. */
      backHref: string;
      /** The reference, set in mono as it is everywhere else it appears. */
      reference: string;
      /** The client name, and on the sourcing screen the Item after it. */
      detail: string;
    };

/**
 * The bar across the top of everything behind the login.
 *
 * **It says where you are.** It used to say the same thing on every screen — a "Tenders"
 * button and the member's name — so a reader could not tell the Tender detail from the
 * list without reading the body. Now the list carries the wordmark, a Tender carries its
 * reference and client, and the sourcing screen carries those and the Item.
 *
 * **One row, at every width.** #56 found six buttons here on a 390px phone with nothing
 * able to wrap — `Button` is `shrink-0 whitespace-nowrap`, so not one of them gives up a
 * pixel — and the bar pushed every screen sideways. Letting it wrap fixed the overflow
 * and cost three rows on a phone, which is most of a small screen spent on navigation.
 * That reasoning is untouched: what is on the bar is location and the language, and
 * People, Group Robot and Sign out stay behind {@link AppMenu}.
 *
 * **The location text is the one part that may be shortened.** A reference and a client
 * name are whatever the client calls them and neither has to contain a space, so
 * `min-w-0` with `truncate` lets them give up space to the controls either side rather
 * than push them off the row — a clipped name is still recognisable and half a button is
 * not. The member's own name has left the bar entirely: it was the widest thing on it and
 * it told the reader nothing they did not know.
 *
 * Rendered on the server, which is why it is sync rather than `async`: `useTranslations`
 * works in a Server Component, and keeping it synchronous is what lets
 * `app-header.layout.test.tsx` measure it in a real browser at 390px.
 *
 * **Each page renders it, rather than the `(app)` layout.** A layout cannot see the
 * params of the page beneath it, so a bar rendered there could never say which Tender
 * this is. `loading.tsx` and `error.tsx` draw the `app` shape for the same reason a
 * skeleton draws boxes: at that moment nobody knows yet which record is coming.
 */
export function AppHeader({
  isOrgAdmin,
  location = { kind: "app" },
}: {
  isOrgAdmin: boolean;
  location?: AppLocation;
}) {
  const t = useTranslations("nav");
  const app = useTranslations("app");

  return (
    <header className="border-hairline bg-card flex min-w-0 items-center justify-between gap-2 border-b px-2 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {location.kind === "app" ? (
          // This link is on every screen in the app, so its prefetch fires most often and
          // is discarded most often — see the note in `tender-row.tsx`.
          <Link
            href="/tenders"
            prefetch={false}
            className="hover:bg-muted flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2 transition-colors"
          >
            <Wordmark />
            <span className="min-w-0 truncate text-sm font-semibold">{app("name")}</span>
          </Link>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={t("back")}
              nativeButton={false}
              render={<Link href={location.backHref} prefetch={false} />}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M15 5l-7 7 7 7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Button>
            {/* Both halves may be shortened, and both have to be able to: a reference
                is whatever the client issued and need not contain a space, so one held at
                `shrink-0` pushed the whole bar off a 390px phone. The reference is capped
                at a share of the row rather than given a free hand, so that a long one
                cannot squeeze the client name out of existence — a clipped name is still
                recognisable, and two clipped halves still say which record this is. */}
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="text-ink-faint max-w-[45%] min-w-0 truncate font-mono text-[11.5px] font-medium tracking-wide">
                {location.reference}
              </span>
              <span className="min-w-0 truncate text-[13px] font-semibold">
                {location.detail}
              </span>
            </span>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <LocaleSwitcher compact />
        <AppMenu isOrgAdmin={isOrgAdmin} />
      </div>
    </header>
  );
}

/**
 * The mark beside the wordmark: a checked box, drawn in signal.
 *
 * Decorative and `aria-hidden` — the app's name is right beside it in words, and a screen
 * reader announcing the logo as well would say it twice.
 */
function Wordmark() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect
        x="2.5"
        y="2.5"
        width="15"
        height="15"
        rx="3.5"
        stroke="var(--signal)"
        strokeWidth="1.6"
      />
      <path
        d="M6.4 10.2l2.4 2.4 4.8-5"
        stroke="var(--signal)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
