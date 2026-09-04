import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { GroupRobotForm } from "@/components/admin/group-robot-form";
import { Measure } from "@/components/ui/screen-body";
import { ScreenHeader } from "@/components/ui/screen-header";
import { currentUser } from "@/lib/auth/session";
import { groupRobotStatus } from "@/lib/wecom/group-robot";

/**
 * Where the org's Group Robot is set up — the webhook every reminder, outcome and
 * Digest leaves through. The second screen in Settings' **Organisation** group.
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
      <ScreenHeader heading={t("title")}>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </ScreenHeader>

      <Measure>
        <section className="border-border flex flex-col gap-4 rounded-lg border p-4">
          <GroupRobotForm configured={status.configured} updatedAt={status.updatedAt} />
        </section>
      </Measure>
    </>
  );
}
