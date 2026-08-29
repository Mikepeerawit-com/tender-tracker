import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import "./globals.css";

/**
 * The Latin and numeral faces. The CJK stack is *not* here: it is declared in
 * `globals.css` and drawn by the device.
 *
 * A Han face cannot be subset the way a Latin one can — there is no 100-glyph slice of a
 * script with tens of thousands of characters — so web-loading one is megabytes over a
 * phone network inside the WeCom webview, on the exact path a Group Robot reminder link
 * takes. IBM Plex Sans was chosen to sit beside PingFang rather than fight it, so the
 * numerals a Chinese reader sees next to their own script were picked rather than
 * inherited from whatever the handset happens to carry.
 *
 * `subsets: ["latin"]` is therefore the whole of what is fetched, and is correct here in
 * a way it was not when it was the only thing declared.
 */
const plexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
