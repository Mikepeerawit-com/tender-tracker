import type { Metadata } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import { getThemeChoice } from "@/lib/theme/cookie";
import { themeClassName } from "@/lib/theme/config";

import "./globals.css";

/**
 * The Latin and numeral faces. The CJK stack is *not* here: it is declared in
 * `globals.css` and drawn by the device.
 *
 * A Han face cannot be subset the way a Latin one can — there is no 100-glyph slice of a
 * script with tens of thousands of characters — so web-loading one is megabytes over a
 * phone network inside the WeCom webview, on the exact path a Group Robot reminder link
 * takes. The Latin face is chosen to sit beside PingFang rather than fight it, so the
 * numerals a Chinese reader sees next to their own script were picked rather than
 * inherited from whatever the handset happens to carry.
 *
 * `subsets: ["latin"]` is therefore the whole of what is fetched, and is correct here in
 * a way it was not when it was the only thing declared.
 *
 * **Fira Sans for the words, Fira Code for the figures**, which is the pairing read the
 * way its own note states it — *code for data, sans for labels*. It is deliberately not
 * the other reading, which puts the monospace on headings: a terminal face set above Han
 * body text is a different app from this one.
 */
const firaSans = Fira_Sans({
  variable: "--font-fira-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

/**
 * The numerals, and the reason they are a monospace rather than a sans with tabular
 * figures turned on: eight competing Quotes are read *down* the working sheet, and a
 * column of numbers only exists if every digit has the same advance width. `.money` in
 * `globals.css` is what points a figure at this, and the working sheet's layout suite is
 * what holds it there.
 */
const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");

  return {
    title: t("name"),
    description: t("description"),
  };
}

/**
 * **The theme is on the document before anything else is** (#133).
 *
 * A pinned light or dark is the server's answer and arrives in the first byte of the
 * markup: there is no moment at which the page is painted in the other one, which is what
 * an Assignee tapping a Group Robot reminder at night is owed — that link lands in the
 * WeCom in-app webview over a phone network, the slowest path in the product and the one
 * where a flash lasts longest.
 *
 * **System is the class `theme-system` and nothing else**, because the operating system's
 * setting is the one thing a server cannot see. `globals.css` answers it with a
 * `prefers-color-scheme` media query rather than with a script, so it too is settled
 * before the first paint rather than corrected after it (ADR-0024).
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const theme = themeClassName(await getThemeChoice());

  return (
    <html
      lang={locale}
      // Light is the absence of a class — `:root` already *is* the light palette — so the
      // trim is what keeps that case from leaving a stray space in the markup.
      className={`${theme} ${firaSans.variable} ${firaCode.variable} h-full antialiased`.trim()}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
