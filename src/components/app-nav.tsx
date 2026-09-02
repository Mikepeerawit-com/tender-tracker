import Link from "next/link";
import { Files, ListTodo, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * **The two destinations**, and the one place they are written down (ADR-0021, #96).
 *
 * A user should be able to see what this app is for without exploring it, and there are
 * exactly two things it is for: the Items you still owe a price on, and the Tenders those
 * Items sit on. `My work` is first because it is the Assignee's own screen and the
 * Assignee is the one holding a phone.
 *
 * **The set is capped at two, and the cap is the reason this list exists.** Two
 * renderings of it have to stay in sync — a bottom bar below `md`, the top app bar above
 * — and that is the honest cost of the split. "Record a tender" is not a third: it is an
 * Owner action, already one tap from the sparsest screen in the app, and a bar item most
 * users must never press is a bar item teaching them to ignore the bar. A third
 * destination is grounds to re-open ADR-0021, not an easy addition here.
 *
 * The label is a **message key rather than a string**, and points at the heading the
 * destination's own screen already draws. A nav that carried its own copy of "My work"
 * could be renamed on the bar and not on the screen it leads to, which is two names for
 * one place — the thing `CONTEXT.md` exists to prevent.
 */
const destinations = [
  { href: "/my-work", label: "myWork.title", icon: ListTodo },
  { href: "/tenders", label: "tenders.title", icon: Files },
] as const satisfies readonly {
  href: string;
  label: string;
  icon: LucideIcon;
}[];

/**
 * The destinations on the top app bar, above `md` and nowhere else.
 *
 * Above `md` a bottom bar is a phone control stranded at the foot of a monitor, so the
 * same two items sit on the bar that is already there. `hidden md:flex` rather than a
 * second render pass: one tree, two viewports, and nothing to keep in step.
 *
 * `shrink-0`, because the identity beside it is the half that may be shortened — a
 * reference and a client name are whatever the client called them, and the note in
 * {@link AppHeader} says why they truncate rather than push.
 */
export function TopNav() {
  const t = useTranslations();

  return (
    <nav
      aria-label={t("nav.destinations")}
      className="hidden shrink-0 items-center gap-1 md:flex"
    >
      {destinations.map((destination) => (
        <NavLink key={destination.href} destination={destination} reachedBy="mouse" />
      ))}
    </nav>
  );
}

/**
 * The destinations at the bottom of the phone, below `md` and nowhere else.
 *
 * **This app is read one-handed inside the WeCom webview**, and the top of that screen
 * already belongs to WeCom's own chrome — so the two places a reader can go are put where
 * a thumb reaches without the hand moving. Each item clears the 44px tap floor
 * `buildspec_2` sets, which is what `min-h-11` is doing on a control this small.
 *
 * **`sticky`, not `fixed`.** A fixed bar is painted over the end of the page and needs
 * every screen to reserve room for it in padding — a rule eight screens would have to
 * remember and one would forget. Sticky keeps its own slot at the foot of the document,
 * so the last row of the longest list is reachable with nothing added to any screen, and
 * the bar is still pinned to the bottom of the viewport on the way there.
 *
 * The trailing padding takes the larger of the ordinary gap and the home-indicator inset:
 * on the iPhones these readers hold, a bar flush to the bottom edge puts its labels under
 * the indicator.
 *
 * **`flex-wrap`, so that the one-row guard can fail.** A bar that cannot wrap cannot be
 * measured for rows: it holds itself on one line whatever it is given and pushes the page
 * sideways instead, which is a different fault caught by a different assertion. Allowed to
 * wrap, a set that has outgrown 390px gets taller rather than wider — exactly what #56's
 * first fix did to the app bar — and `controlRows` sees it. Nothing wraps today, and that
 * is the claim being pinned rather than a shape being permitted.
 *
 * **There is deliberately no Active Org switcher here**, and the shape is chosen so that
 * one can arrive later without becoming a third destination for everybody else: the two
 * items are sized to their words and centred, rather than stretched to half the width
 * each, so there is a control's worth of room left at either end. `app-nav.layout.test.tsx`
 * measures that room, because a claim about what will still fit is worth nothing unless
 * something can fail when it stops fitting (ADR-0016).
 */
export function BottomNav() {
  const t = useTranslations();

  return (
    <nav
      aria-label={t("nav.destinations")}
      className="border-hairline bg-card sticky bottom-0 z-40 flex flex-wrap items-center justify-center gap-2 border-t px-2 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] md:hidden"
    >
      {destinations.map((destination) => (
        <NavLink key={destination.href} destination={destination} reachedBy="thumb" />
      ))}
    </nav>
  );
}

/**
 * One destination, drawn the same way in both bars.
 *
 * **The icon is beside the word and never instead of it**, in either script. That extends
 * ADR-0019's rule that colour never carries the only copy of a meaning to the other thing
 * a screen can be read badly through: a reader meeting this bar for the first time should
 * never have to guess a metaphor, and a reader re-finding a place they have been should be
 * able to use the shape. `aria-hidden` on the glyph for the same reason the wordmark
 * carries it — the word is right there, and a screen reader saying it twice says nothing
 * extra.
 *
 * **Neither destination is marked as the current one, and that is a decision.** The app
 * bar already says where the reader is — that is the whole of what #73 bought it — so a
 * second, quieter claim about the same thing here would be a duplicate on every screen
 * and a contradiction on the ones the bar names by record. Marking it would also mean
 * reading the path in the middle of the tree, which turns both bars into Client
 * Components for a state the screen's own heading is already stating in words. If a
 * reader is ever seen losing their place between two labelled destinations, this is the
 * thing to add.
 *
 * `prefetch={false}`: these two links are on every screen behind the login, so their
 * prefetch fires more often and is discarded more often than any other in the app. See
 * the note in `tender-row.tsx`.
 */
function NavLink({
  destination,
  reachedBy,
}: {
  destination: (typeof destinations)[number];
  /**
   * The only thing that differs between the two bars, and the reason it differs: a thumb
   * is aimed less precisely than a pointer, so the bottom bar's items are given more
   * width around the word than the ones sat among the app bar's other controls. The
   * height is the same 44px floor either way — that floor is about the target, not the
   * device that hits it.
   */
  reachedBy: "thumb" | "mouse";
}) {
  const t = useTranslations();
  const Icon = destination.icon;

  return (
    <Link
      href={destination.href}
      prefetch={false}
      className={`hover:bg-muted flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium transition-colors ${
        reachedBy === "thumb" ? "px-4" : "px-3"
      }`}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {t(destination.label)}
    </Link>
  );
}
