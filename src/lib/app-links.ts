import "server-only";

/**
 * Where the app lives, and the three places a group message can send somebody.
 *
 * ## Why the app has to be told its own address
 *
 * Every link this module builds is built during the daily cron run, where there is no
 * request to read a `Host` header off and no browser to ask. The only URL the environment
 * held before this was Supabase's, and the one link to this app that already worked — the
 * invite — comes from Supabase Auth's redirect configuration rather than from here. So
 * the origin arrives as configuration, and a deployment that was not given one does not
 * know where it is (#59).
 *
 * ## A missing origin costs links, never messages
 *
 * {@link linksFor} answers `null` for every link when there is no origin, and every
 * message builder renders `null` as the message it sent before this existed. **Reminders
 * are the entire product**: a run suppressed over an unset configuration line would turn
 * a formatting gap into the exact failure this app is for, which is the kind of
 * silent-failure machine ADR-0005 refuses in this engine specifically.
 *
 * The fault surfaces one level up instead — `/api/health` reports a missing origin as its
 * own named status and the deployment gate goes red on it, so a deployment cannot reach
 * production with linkless reminders unnoticed (ADR-0016).
 *
 * ## What a link may carry
 *
 * Ids, and nothing else. A URL naming a Tender or an Item discloses no more than the
 * message around it already does, and the financial detail stays where ADR-0012 put it:
 * behind login and RLS, in the app the link exists to drive people to. See the financial
 * silence note in `@/lib/wecom/messages.ts`.
 *
 * **No locale segment** (ADR-0011). Locale is not in the URL, and the reader gets their
 * own stored one on arrival — a link that pinned one would hand every reader in the group
 * whichever locale the run happened to build with.
 */

/**
 * What the environment said, and — when it will not do — why not, in a sentence the
 * deployment gate prints as the whole of what a reader sees.
 *
 * A discriminated pair rather than `string | null`, because the two readers want
 * different halves: the message builders want the origin or nothing, and `/api/health`
 * wants to name the fault. Collapsing them would leave the health endpoint reporting
 * "no origin" for a value somebody did set and got wrong, which is a different errand.
 */
export type AppOrigin = { origin: string; error: null } | { origin: null; error: string };

/**
 * The app's public origin, validated rather than trusted.
 *
 * This is the one variable in this repo read for its *value* instead of handed to a
 * client library that would complain itself, and the value ends up in a message posted
 * unretractably into a company group chat. So each rejection below is a string somebody
 * plausibly pastes into a settings field, and each is named rather than collapsed into
 * "invalid": a trailing slash is a normalisation, `http` is a different mistake from a
 * path, and the fixes differ.
 */
export function appOrigin(): AppOrigin {
  const value = (process.env.APP_ORIGIN ?? "").trim();

  if (value === "") {
    return {
      origin: null,
      error:
        "APP_ORIGIN is not set, so group messages carry no link into the app. " +
        "Set it to the app's absolute https origin, with no trailing slash.",
    };
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return { origin: null, error: refused(value, "is not an absolute URL") };
  }

  // A reminder link lands in WeCom's in-app webview, which is where login has to work.
  // `http` there is a different product decision from a typo, and neither belongs in a
  // string this concatenates without looking.
  if (url.protocol !== "https:") {
    return { origin: null, error: refused(value, "is not https") };
  }

  // `new URL(…).origin` would drop a path silently, which is the one outcome worse than
  // refusing: links would be built against an origin nobody configured, and would 404
  // from a message that cannot be unposted. A trailing slash is the exception — it means
  // the same thing as no slash, so it is normalised rather than refused.
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    return {
      origin: null,
      error: refused(value, "is not a bare origin — it carries a path, query or fragment"),
    };
  }

  return { origin: url.origin, error: null };
}

function refused(value: string, why: string): string {
  return `APP_ORIGIN is set to ${value}, which ${why}. It must be the app's absolute https origin, with no trailing slash.`;
}

/** The three destinations a group message can name. `null` when the app has no origin. */
export type AppLinks = {
  /** The Tenders list — where the Digest sends a reader. */
  tenders(): string | null;
  /** One Tender's detail screen — where a reminder sends a reader. */
  tender(tenderId: string): string | null;
  /** One Item's sourcing screen, where its Quotes live — where outcome news sends a reader. */
  tenderItem(tenderId: string, itemId: string): string | null;
};

/**
 * Links against a given origin, or silence when there is none.
 *
 * Pure and origin-injected, so the paths can be held against the routes on disk without
 * an environment — `app-links.test.ts` pairs each one with its `page.tsx`, which is the
 * only way a moved route gets noticed. Nothing in the app imports these paths, because
 * in-app navigation goes through `<Link>`; a group message is the sole reader, and a
 * broken one is a 404 in a chat nobody can edit.
 */
export function linksFor(origin: string | null): AppLinks {
  const link = (path: string) => (origin === null ? null : `${origin}${path}`);
  // `encodeURIComponent` on ids that are uuids today and need not stay uuids. Free, and
  // it keeps a path separator arriving in an id from inventing a route.
  const id = encodeURIComponent;

  return {
    tenders: () => link("/tenders"),
    tender: (tenderId) => link(`/tenders/${id(tenderId)}`),
    tenderItem: (tenderId, itemId) =>
      link(`/tenders/${id(tenderId)}/items/${id(itemId)}/quote`),
  };
}

/** {@link linksFor} against the configured origin — what the cron run and the writes use. */
export function appLinks(): AppLinks {
  return linksFor(appOrigin().origin);
}
