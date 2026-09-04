import type { ReactNode } from "react";

import { LocaleSwitcher } from "@/components/locale-switcher";

/**
 * The frame every signed-out screen sits in.
 *
 * Built for the WeCom in-app webview first, because that is where every reminder link
 * lands and there is no way out of it into Safari. That constraint is what the layout
 * is: one column, no dialogs, no client-side routing, nothing that assumes a URL bar,
 * and controls at 44px so they are hittable on a phone.
 *
 * The language switcher is here rather than only behind the login, because someone who
 * cannot read the form cannot get past it.
 */
export function AuthScreen({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  /** Optional: a signed-out screen can be a notice with nothing to fill in, as `/setup` is once it has run. */
  children?: ReactNode;
}) {
  return (
    <div className="bg-background flex flex-1 flex-col items-center justify-center p-6">
      <main className="flex w-full max-w-sm flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="text-muted-foreground text-sm">{description}</p>
          ) : null}
        </header>

        {children}

        <footer className="flex justify-center pt-2">
          <LocaleSwitcher />
        </footer>
      </main>
    </div>
  );
}
