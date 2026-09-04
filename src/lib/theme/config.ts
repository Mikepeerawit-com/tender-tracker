/**
 * The three answers a member can give about how this app is painted, and the class each
 * one puts on the document.
 *
 * **System is the default and is a stored answer rather than the absence of one.** A
 * reader who has never opened Preferences follows their device, which is the answer
 * nobody has to be asked for — and a reader who pinned dark and came back to System did
 * something, which a null could not tell apart from never having decided (ADR-0024).
 *
 * Pure, and imported by the switcher in the browser as well as by the root layout on the
 * server. The half that reads and writes the cookie is next door in `theme.ts`, which is
 * `server-only`.
 */
export const themeChoices = ["system", "light", "dark"] as const;

export type ThemeChoice = (typeof themeChoices)[number];

export const defaultThemeChoice: ThemeChoice = "system";

/**
 * Where the choice is remembered for the *renderer*, which reads it on every request
 * before there is any session to ask. `users.theme` is what remembers it for the
 * *member*, across devices — the same division `NEXT_LOCALE` and `users.locale` already
 * have, and for the same reason: the signed-out screens are painted too, and the root
 * layout must answer before a page has decided who is looking.
 */
export const themeCookieName = "THEME";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === "string" && themeChoices.includes(value as ThemeChoice);
}

/**
 * The class the server writes onto `<html>`, from the reader's first byte.
 *
 * **Light is the absence of a class**, and deliberately so: `:root` in `globals.css`
 * *is* the light palette, so pinning light is not an override of anything — it is the
 * ground the file already states. A `theme-light` class would be a selector that
 * restated the default, and one more thing that has to be applied correctly for the app
 * to be legible.
 *
 * **`dark` rather than `theme-dark`**, because it is the class Tailwind's `dark:`
 * variant and every shadcn component in this repo already expect. `theme-system` is the
 * one new name, and it carries the case the server cannot answer: the class says *ask
 * the device*, and `globals.css` asks it with a media query rather than with a script.
 */
export function themeClassName(choice: ThemeChoice): string {
  return { system: "theme-system", light: "", dark: "dark" }[choice];
}
