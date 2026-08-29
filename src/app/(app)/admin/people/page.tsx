import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { InviteForm } from "@/components/admin/invite-form";
import { TestMentionButton } from "@/components/admin/test-mention-button";
import { WecomUseridForm } from "@/components/admin/wecom-userid-form";
import { Screen } from "@/components/screen";
import { currentUser } from "@/lib/auth/session";
import { createSessionClient } from "@/lib/supabase/session-client";

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

  const { data: members } = await createSessionClient(store)
    .from("users")
    .select("id, name, email, wecom_userid, is_org_admin, disabled_at")
    .order("name");

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
          {(members ?? []).map((member) => (
            <li
              key={member.id}
              className="border-border flex flex-col gap-3 rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{member.name}</span>
                <span className="text-muted-foreground text-sm">{member.email}</span>
                {member.is_org_admin ? (
                  <span className="bg-muted rounded-md px-2 py-0.5 text-xs">
                    {t("orgAdmin")}
                  </span>
                ) : null}
                {member.disabled_at ? (
                  <span className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs">
                    {t("disabled")}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <WecomUseridForm userId={member.id} value={member.wecom_userid} />
                <TestMentionButton
                  userId={member.id}
                  hasUserid={Boolean(member.wecom_userid)}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </Screen>
  );
}
