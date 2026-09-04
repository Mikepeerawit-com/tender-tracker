"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { ScreenBody } from "@/components/ui/screen-body";
import { ScreenHeader } from "@/components/ui/screen-header";

/**
 * What a screen behind the login shows when it threw instead of rendering.
 *
 * The app had no `error.tsx` anywhere (#57), which is the difference between a query that
 * failed and a blank white page. Blank is the worst of the two: there is nothing on it to
 * act on and nothing to report, so the person holding the phone reloads, gets the same
 * nothing, and concludes the app is broken rather than that one fetch was.
 *
 * Split out of `(app)/error.tsx` for the same reason `ScreenSkeleton` is split out of
 * `(app)/loading.tsx`: the route file is a Next convention with a fixed signature, and a
 * plain component beside `ScreenHeader` is what the layout project can render at 390×844.
 *
 * **No `console.error`, deliberately**, though the Next docs' example has one. An error
 * thrown in a Server Component reaches the client already stripped to a generic message
 * plus a digest — the real one is in the server log under that same digest — so logging
 * it again would print nothing new, into a console that nobody can open inside the WeCom
 * webview this is read in. The digest is on the screen instead, where it can be quoted.
 *
 * It composes {@link ScreenBody} rather than `Screen`, for two reasons that each hold on
 * their own. `Screen` draws the app bar, and `(app)/error.tsx` draws its own above this —
 * a screen that threw is exactly where the way back to the list must still be there. And
 * `Screen` reaches for the session, which a Client Component cannot do. What is shared is
 * the wrapper — since ADR-0022 the same region as the screen that threw, so a reader is no
 * longer moved sideways on their way to bad news. `screen-skeleton.tsx` says what is left
 * of that trade, which is the measure and nothing else.
 */
export function ScreenError({
  digest,
  retry,
}: {
  /** Next's hash of the thrown error, matching the server log. Absent on client errors. */
  digest?: string;
  /** Re-fetch and re-render the segment. Next's own prop, passed straight through. */
  retry: () => void;
}) {
  const t = useTranslations("app.error");

  return (
    <ScreenBody>
      <ScreenHeader
        heading={t("title")}
        actions={
          <Button className="h-11" onClick={() => retry()}>
            {t("retry")}
          </Button>
        }
      >
        <p className="text-muted-foreground text-sm break-words">{t("explain")}</p>
        {digest ? (
          <p className="text-muted-foreground font-mono text-xs break-all">
            {t("reference", { digest })}
          </p>
        ) : null}
      </ScreenHeader>
    </ScreenBody>
  );
}
