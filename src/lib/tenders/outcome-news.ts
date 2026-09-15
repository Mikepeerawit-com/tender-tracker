import "server-only";

import { defaultLocale, isLocale, type Locale } from "@/i18n/config";
import { appLinks } from "@/lib/app-links";
import { sendEmails, type EmailBoundary, type EmailMessage } from "@/lib/email/send";
import {
  otherQuotesOutcomeEmail,
  otherQuotesOutcomeMessage,
  selectedQuoteOutcomeEmail,
  selectedQuoteOutcomeMessage,
  type AnnouncedOutcome,
} from "@/lib/messaging/messages";
import { createServiceClient } from "@/lib/supabase/service-client";
import { webhookFor } from "@/lib/wecom/group-robot";
import { sendGroupMessages, type GroupMessage, type RobotBoundary } from "@/lib/wecom/robot";

/**
 * The group post that follows a Tender Item being won or lost.
 *
 * ## Why this is not on the cron
 *
 * Every other message this app sends answers "what is coming up", which is a question
 * about today and belongs to a job that runs once a day. This one answers "what just
 * happened", and a win announced at 08:00 tomorrow is news everybody already had from the
 * person who took the call. It rides the same robot seam and the same financial-silence
 * rules; it just fires on the write.
 *
 * ## Who hears it, and why it is not just the winner
 *
 * **Every Assignee who quoted the Item**, including — especially — the ones whose Quote
 * was not selected. Assignees compete rather than divide (ADR-0004): several of them ring
 * their own suppliers for the same Item, and this message is the *only* feedback anywhere
 * in the app on how theirs compared. Restrict it to the winner and the losers learn that
 * sourcing an Item somebody else will win is wasted effort, which is the one lesson the
 * competing-Assignees design cannot survive.
 *
 * `won` and `lost` only. `no_bid` and `cancelled` are silent, because neither is a verdict
 * on anybody's sourcing — one is us choosing not to bid and the other is the client
 * pulling the Item — and a robot that posts about non-events is a robot people mute.
 *
 * ## Why a failure here does not fail the write
 *
 * The opposite of the reminder path, and deliberately. There, a schedule that was never
 * written is invisible until the morning it is too late, so the write is rolled back. Here
 * the Outcome is a fact that has already been recorded and re-recording it is a no-op by
 * design (`setItemOutcome` refuses to re-date a decision), so a caller sent back to retry
 * would save again, send nothing, and be told it worked. Reporting failure would cost the
 * user their Outcome and buy them nothing.
 *
 * **Not failing the write is not the same as swallowing the failure.** There is no row to
 * leave unsent here and so no next run to recover it, which is the one respect in which
 * this message is weaker than a reminder — so a refused post is written to the server log
 * with WeCom's own words, and the bell rows are written regardless. The alternative, a
 * post that vanishes with no trace anywhere, is the shape ADR-0005 exists to forbid.
 */

type ItemRow = {
  id: string;
  org_id: string;
  tender_id: string;
  product_name: string;
  selected_quote_id: string | null;
  tender: { reference: string; client_name: string } | null;
};

type QuoterRow = { id: string; created_by_user_id: string };

type Recipient = {
  name: string;
  email: string;
  locale: Locale;
  disabled: boolean;
  wecomUserid: string | null;
};

/** Both outbound boundaries the announcement stands at, injected together. */
export type OutboundBoundary = { robot?: RobotBoundary; email?: EmailBoundary };

/**
 * Tell everybody who quoted — by email always, in the group as well when the org has a
 * robot (ADR-0034) — and leave a bell row for each of them.
 *
 * Best effort throughout: it returns nothing, and every branch that cannot proceed simply
 * stops rather than reporting. Nothing it calls raises past it — `supabase-js` answers
 * with an `error` field rather than an exception, both transports turn every wire and
 * protocol failure into a `SendOutcome`, `sendGroupMessages`'s one throw (a blank
 * webhook) is unreachable because `webhookFor` reports a blank as no robot at all, and
 * `sendEmails`'s one throw (blank `RESEND_API_KEY`/`EMAIL_FROM`) is caught and logged
 * below, because `/api/health` is where that deployment fault belongs (ADR-0034). All
 * of that matters because this is called from inside a server action whose real job
 * has already succeeded.
 */
export async function announceOutcome(
  { itemId, outcome }: { itemId: string; outcome: AnnouncedOutcome },
  boundary: OutboundBoundary = {},
): Promise<void> {
  const service = createServiceClient();

  const { data: item } = await service
    .from("tender_items")
    .select(
      "id, org_id, tender_id, product_name, selected_quote_id, " +
        "tender:tenders(reference, client_name)",
    )
    .eq("id", itemId)
    .maybeSingle()
    .overrideTypes<ItemRow, { merge: false }>();

  if (!item?.tender) return;

  const { data: quotes } = await service
    .from("quotes")
    .select("id, created_by_user_id")
    .eq("tender_item_id", itemId)
    .overrideTypes<QuoterRow[], { merge: false }>();

  const quoterIds = [...new Set((quotes ?? []).map((quote) => quote.created_by_user_id))];

  // Nobody sourced this Item, so there is nobody the news is feedback for. The Tender's
  // own outcome is on the worklist, where the Owner will read it.
  if (quoterIds.length === 0) return;

  const people = await peopleById(quoterIds, item.org_id);

  // Who we actually bid. Null when the Item was decided with no Quote ever selected —
  // ordinary on a `lost` Item nobody got round to picking a Quote for.
  const selectedBy =
    (quotes ?? []).find((quote) => quote.id === item.selected_quote_id)
      ?.created_by_user_id ?? null;

  const messages = outcomeMessages({
    reference: item.tender.reference,
    client: item.tender.client_name,
    item: item.product_name,
    outcome,
    selectedBy,
    quoterIds,
    people,
    // The Item, not the Tender: this news is about one Item, and the Item's sourcing
    // screen is where its Quotes live — including the reader's own, which is what
    // "your quote was not selected" is sending them to go and look at.
    link: appLinks().tenderItem(item.tender_id, item.id),
  });

  // Written whatever the sends do, and **this is where it differs from the reminder
  // path**. A reminder that a transport refused is retried tomorrow, so writing its
  // bell rows now would double them; this fires once and is never retried, so a
  // refused post that also skipped the bell would leave the loser of a Tender told by
  // nothing at all.
  await writeNotifications(item, outcome, quoterIds, selectedBy);

  // Email first, because it is the floor (ADR-0034): it reaches every quoter for every
  // org, robot or none, in each reader's own language. Fire-once like the post — a
  // refusal is logged with the provider's words and nothing is queued.
  const emails = outcomeEmails({
    reference: item.tender.reference,
    client: item.tender.client_name,
    item: item.product_name,
    outcome,
    selectedBy,
    quoterIds,
    people,
    link: appLinks().tenderItem(item.tender_id, item.id),
  });

  try {
    const emailOutcomes = await sendEmails(emails, boundary.email);

    for (const [index, result] of emailOutcomes.entries()) {
      if (result.ok) continue;

      // The address and the provider's words, never the content: this line reaches the
      // deployment's logs, and what was said is the org's business.
      console.warn(
        `Outcome news email to ${emails[index].to} for tender_item ${item.id} was refused: ${result.detail}`,
      );
    }
  } catch (cause) {
    // The transport throws on a blank key or sender, and `/api/health` is where that
    // deployment fault is caught (ADR-0034). It must not be caught *here* by failing a
    // write that already succeeded — the never-raises contract above stands — and it
    // must not cost the group post below, which is the channel such a deployment still
    // has.
    console.warn(
      `Outcome news email for tender_item ${item.id} was not sent — email is not configured: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (messages.length === 0) return;

  const webhook = await webhookFor(item.org_id);

  // An org that has not set up a Group Robot has not failed a send. There is nowhere
  // to post and nothing to retry; the emails and bell rows above are what it gets —
  // which since ADR-0034 is the whole story rather than a downgrade.
  if (webhook === null) return;

  // One call rather than two, so the ~3s pacing sits between the winner's message and the
  // rest — a two-message burst is inside the cap either way, but pacing lives in the
  // sender and splitting the batch would be the one caller that opts out of it.
  const outcomes = await sendGroupMessages(webhook, messages, boundary.robot);

  for (const result of outcomes) {
    if (result.ok) continue;

    // WeCom's own words, and never the webhook — it is a bearer credential and this line
    // reaches the deployment's logs. The Item, so the entry can be tied to a decision.
    console.warn(
      `Outcome news for tender_item ${item.id} was refused: ${result.detail}`,
    );
  }
}

/**
 * The same two audiences as {@link outcomeMessages}, told the same two facts, one
 * reader at a time: the Assignee whose Quote we bid, and everybody else who quoted.
 * A Disabled quoter is sent nothing on any channel — though their name may still be
 * the one the others are given, because "we bid Nok's quote" stays true of a Nok who
 * has since left.
 */
function outcomeEmails({
  reference,
  client,
  item,
  outcome,
  selectedBy,
  quoterIds,
  people,
  link,
}: {
  reference: string;
  client: string;
  item: string;
  outcome: AnnouncedOutcome;
  selectedBy: string | null;
  quoterIds: string[];
  people: Map<string, Recipient>;
  link: string | null;
}): EmailMessage[] {
  return quoterIds.flatMap((userId) => {
    const person = people.get(userId);

    if (person === undefined || person.disabled) return [];

    const content =
      userId === selectedBy
        ? selectedQuoteOutcomeEmail({
            locale: person.locale,
            reference,
            client,
            item,
            outcome,
            link,
          })
        : otherQuotesOutcomeEmail({
            locale: person.locale,
            reference,
            client,
            item,
            outcome,
            // A colleague's name, never a supplier's — the disclosure ADR-0012 permits
            // in the same breath as forbidding the supplier's. Null when we have no
            // name to give.
            selectedBy:
              selectedBy === null ? null : (people.get(selectedBy)?.name ?? null),
            link,
          });

    return [{ to: person.email, ...content }];
  });
}

/**
 * One message, or two.
 *
 * Two audiences are being told two different things — "we went with yours" against "we
 * went with somebody else's" — so they cannot share a message: WeCom renders one body for
 * everybody in the group, and wording vague enough to be true for both is wording nobody
 * acts on. It collapses back to one whenever there is only one audience: the sole quoter
 * who was selected, or an Item decided with no Quote picked at all.
 */
function outcomeMessages({
  reference,
  client,
  item,
  outcome,
  selectedBy,
  quoterIds,
  people,
  link,
}: {
  reference: string;
  client: string;
  item: string;
  outcome: AnnouncedOutcome;
  selectedBy: string | null;
  quoterIds: string[];
  people: Map<string, Recipient>;
  link: string | null;
}): GroupMessage[] {
  // Both messages are about the same Item, so both point at the same screen.
  const head = { reference, client, item, outcome, link };
  const others = quoterIds.filter((userId) => userId !== selectedBy);
  const messages: GroupMessage[] = [];

  if (selectedBy !== null && quoterIds.includes(selectedBy)) {
    messages.push(
      selectedQuoteOutcomeMessage({ ...head, mentions: mentionsFor([selectedBy], people) }),
    );
  }

  if (others.length > 0) {
    messages.push(
      otherQuotesOutcomeMessage({
        ...head,
        // A colleague's name, never a supplier's — the disclosure ADR-0012 permits in the
        // same breath as forbidding the supplier's. Null when we have no name to give.
        selectedBy: selectedBy === null ? null : (people.get(selectedBy)?.name ?? null),
        mentions: mentionsFor(others, people),
      }),
    );
  }

  return messages;
}

/**
 * The in-app rows the bell will one day be a read model over.
 *
 * `body` carries whether this reader's own Quote is the one we bid, and nothing else —
 * the same discipline the reminder path applies to a deadline. A notification has exactly
 * one reader, so unlike a group message it *can* be translated, and the sentence therefore
 * belongs in `src/messages/` and is rendered from `type` and this at the moment the bell
 * is built. The two values are the two wordings, named rather than spelled out.
 */
async function writeNotifications(
  item: ItemRow,
  outcome: AnnouncedOutcome,
  quoterIds: string[],
  selectedBy: string | null,
): Promise<void> {
  await createServiceClient()
    .from("notifications")
    .insert(
      quoterIds.map((userId) => ({
        org_id: item.org_id,
        user_id: userId,
        type: `outcome:${outcome}`,
        // Both, unlike the reminder path's Tender-level rows: the news is about one
        // Item, and the bell still needs the Tender to build a link to it.
        tender_id: item.tender_id,
        tender_item_id: item.id,
        body: userId === selectedBy ? "selected" : "not_selected",
      })),
    );
}

/**
 * Everybody who quoted, by id — their name for the message, their userid for the @.
 *
 * Scoped to the Item's org even though a quote on it cannot belong to another one. The
 * service role reads past RLS, so every query on this path states the boundary the
 * session client would otherwise have stated for it.
 */
async function peopleById(
  userIds: string[],
  orgId: string,
): Promise<Map<string, Recipient>> {
  const { data } = await createServiceClient()
    .from("users")
    .select("id, name, email, locale, wecom_userid, disabled_at")
    .in("id", userIds)
    .eq("org_id", orgId);

  return new Map(
    (data ?? []).map((user) => [
      user.id,
      {
        name: user.name,
        email: user.email as string,
        // Null until their first sign-in; the default is what a null reads as, so a
        // colleague who never signed in is reached in *some* language (ADR-0034).
        locale: isLocale(user.locale) ? user.locale : defaultLocale,
        // A Disabled colleague reads nothing and can act on none of it: no email, and
        // @-ing them would put a name in the group chat that answers to nobody.
        disabled: user.disabled_at !== null,
        wecomUserid: user.disabled_at === null ? (user.wecom_userid ?? null) : null,
      },
    ]),
  );
}

/**
 * The @-list, with the blanks dropped rather than sent.
 *
 * `mentioned_list: [""]` is accepted with `errcode 0` and notifies nobody, so an unfilled
 * identifier would be indistinguishable from a working one from this side of the webhook.
 */
function mentionsFor(userIds: string[], people: Map<string, Recipient>): string[] {
  return userIds
    .map((userId) => people.get(userId)?.wecomUserid?.trim() ?? "")
    .filter((userid) => userid !== "");
}
