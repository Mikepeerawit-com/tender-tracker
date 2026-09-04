"use client";

import { useId } from "react";
import { Menu } from "@base-ui/react/menu";
import { Menu as MenuIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

/**
 * The controls that do not earn a permanent seat on the bar.
 *
 * #56 put six buttons on a 390px header and they did not fit; wrapping them cleared the
 * overflow but cost three rows on a phone, which is most of the screen given over to
 * navigation nobody is looking at. This is the other answer: the two destinations a
 * reader goes to daily — the tender list, and the language they read it in — stay on the
 * bar, and everything rarer moves behind one trigger.
 *
 * **Sign out is deliberately in here** even though it is the one item every member has.
 * It is pressed once a day at most, and a destructive-ish control sitting a thumb's width
 * from the nav is how people sign out by accident on a phone.
 *
 * The menu renders for everybody rather than only for admins, so the bar is the same
 * shape for every member. A member's menu holds one item, which is a smaller oddity than
 * a header that changes structure depending on who is looking at it.
 */
export function AppMenu({ isOrgAdmin }: { isOrgAdmin: boolean }) {
  const t = useTranslations("nav");
  // The sign-out form lives outside the popup and is reached by `form=`: the popup is
  // portalled to the end of the body, so a form wrapping it would not survive the move.
  const signOutFormId = useId();

  return (
    <>
      <form id={signOutFormId} action={signOutAction} className="hidden" />

      <Menu.Root>
        <Menu.Trigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={t("menu")}
            >
              <MenuIcon />
            </Button>
          }
        />
        <Menu.Portal>
          <Menu.Positioner sideOffset={8} align="end" className="z-50">
            <Menu.Popup className="border-border bg-background text-foreground min-w-44 rounded-lg border p-1 shadow-lg outline-none">
              {isOrgAdmin ? (
                <>
                  <Menu.LinkItem href="/admin/people" className={item}>
                    {t("people")}
                  </Menu.LinkItem>
                  <Menu.LinkItem href="/admin/group-robot" className={item}>
                    {t("groupRobot")}
                  </Menu.LinkItem>
                  <Menu.LinkItem href="/admin/currency-conversion" className={item}>
                    {t("currencyConversion")}
                  </Menu.LinkItem>
                  <div role="separator" className="bg-border my-1 h-px" />
                </>
              ) : null}
              <Menu.Item
                className={item}
                render={<button type="submit" form={signOutFormId} />}
              >
                {t("signOut")}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </>
  );
}

/**
 * `min-h-11`, not the `h-8` a menu row would take on a desktop: these are thumb targets
 * on a phone, and buildspec_2's 44px floor applies to a control in a popup exactly as it
 * applies to one on the bar.
 */
const item =
  "flex min-h-11 w-full cursor-default items-center rounded-md px-3 text-sm outline-none select-none data-[highlighted]:bg-muted";
