import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AppHeader } from "@/components/app-header";
import { GroupRobotForm } from "@/components/admin/group-robot-form";
import { currentUser } from "@/lib/auth/session";
import { groupRobotStatus } from "@/lib/wecom/group-robot";

/**
 * Where the org's Group Robot is set up — the webhook every reminder, outcome and
 * Digest leaves through.
 *
 * Hidden from non-admins with `notFound()` rather than a redirect, for the same reason
 * the People screen is: a page that says "you are not allowed here" also says that here
 * exists. The real gate is in the server action.
 *
 * The page asks for {@link groupRobotStatus}, which cannot carry the webhook. That is
 * the point — the URL is a bearer credential, and the way it stays out of the HTML is
 * that the function the page can reach does not return it.
 */
export default async function GroupRobotPage() {
  const store = await cookies();
  const user = await currentUser(store);

  if (!user?.isOrgAdmin) notFound();

  const t = await getTranslations("groupRobot");
  const status = await groupRobotStatus(store);

  // Belt and braces with the check above: the gate that matters is the one in the
  // server action, and this page renders nothing it was not given.
  if (status === null) notFound();

  return (
    <>
      <AppHeader isOrgAdmin={user.isOrgAdmin} />
      <div className="flex flex-1 flex-col gap-8 p-6">
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </header>

        <section className="border-border flex flex-col gap-4 rounded-lg border p-4">
          <GroupRobotForm
            configured={status.configured}
            updatedAt={status.updatedAt}
          />
        </section>
      </main>
      </div>
    </>
  );
}
