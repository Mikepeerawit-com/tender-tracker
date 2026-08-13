# The locale lives on the user, not in the URL

Ticket 21 ([#21](https://github.com/Mikepeerawit-com/tender-tracker/issues/21)) wires next-intl. next-intl's default shape is locale-prefixed routing — `/en/tenders/…`, `/zh-Hans/tenders/…` — and this project deliberately does not use it. There is **one URL per thing**, and the locale is resolved server-side from the user.

## Why

- **`users.locale` is the source of truth, and it is nullable.** The spec has the app *ask* on first start-up rather than infer. A locale segment in the path would be a second, competing answer to the same question, and the two drift the moment someone shares a link.
- **Reminder deep links are posted into WeCom by a robot, not by a browser.** The robot knows a Tender's id; it does not know who will tap the link, and the group holds readers of both locales. A path that has to encode a locale forces the robot to pick one, and the person who taps it gets the wrong one.
- **The audience is under ten internal users.** Locale-prefixed routing pays for itself in SEO and in shareable per-language URLs. This app is behind a login, is never crawled, and its links are shared between colleagues who each have their own locale preference.

Until there is a `users` row to read, the choice is remembered in a `NEXT_LOCALE` cookie, set server-side. When ticket 23 lands accounts, the user row takes precedence and the cookie becomes the pre-login fallback — the switcher and every `getTranslations` call are unaffected, because both already go through `getLocale()` in `src/i18n/locale.ts`.

## Consequences

- **No `[locale]` route segment, and no next-intl middleware.** Adding either later means every route in the app moves, so it is worth being explicit that this was a decision.
- **Pages that read the locale are dynamic.** `getLocale()` reads a cookie, so a page rendering translated text opts out of static rendering. For an authenticated internal tool where every page is user-specific anyway, this costs nothing.
- **The switcher writes a cookie through a server action and revalidates the layout.** It never navigates, so switching language never changes the URL or loses the user's place.
