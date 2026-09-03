import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { InviteForm } from "@/components/admin/invite-form";
import { MembershipControls } from "@/components/admin/membership-controls";
import { TestMentionButton } from "@/components/admin/test-mention-button";
import { WecomUseridForm } from "@/components/admin/wecom-userid-form";
import { Screen } from "@/components/screen";
import { currentUser } from "@/lib/auth/session";
import { listMemberships } from "@/lib/org/members";

/**
 * The only administrative screen in v1: who is in the org, inviting someone new, and
 * the WeCom userid the group robot needs to @mention them.
 *
 * Hidden from non-admins with `notFound()` rather than a redirect, because a page that
 * announces "you are not allowed here" also announces that here exists. The real gate
 * is in the server actions — this only decides what gets drawn.
 */
export default async function PeoplePage() {
  const store = await cookies();
  const user = await currentUser(store);

  if (!user?.isOrgAdmin) notFound();

  const t = await getTranslations("people");

  // Read through `listMemberships` rather than issued here: this page cannot be called by
  // any test, so a query written in it — and the ordering rule it carries — is
  // unreviewable (#119).
  const members = await listMemberships(store);

  return (
    <Screen>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </header>

      <section className="border-border flex flex-col gap-4 rounded-lg border p-4">
        <h2 className="text-sm font-medium">{t("invite.title")}</h2>
        <InviteForm />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">{t("members")}</h2>
        <ul className="flex flex-col gap-4">
          {members.map((member) => (
            <li
              key={member.id}
              className="border-border flex flex-col gap-3 rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{member.name}</span>
                <span className="text-muted-foreground text-sm">{member.email}</span>
                {member.isOrgAdmin ? (
                  <span className="bg-muted rounded-md px-2 py-0.5 text-xs">
                    {t("orgAdmin")}
                  </span>
                ) : null}
                {member.disabledAt ? (
                  <span className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs">
                    {t("disabled")}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <WecomUseridForm userId={member.id} value={member.wecomUserid} />
                <TestMentionButton
                  userId={member.id}
                  hasUserid={Boolean(member.wecomUserid)}
                />
                {/* Drawn on the admin's own row too. In the org this ships as — one Org
                    Admin, because promoting a second is a dashboard `update` — that row is
                    where the last-Administrator refusal gets read, and it is the only place
                    the app ever explains why an org must keep one. Hiding it would trade a
                    mis-click nobody has made for a question nobody can get answered. */}
                <MembershipControls userId={member.id} disabledAt={member.disabledAt} />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </Screen>
  );
}
