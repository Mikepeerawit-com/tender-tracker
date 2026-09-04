import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { NextIntlClientProvider } from "next-intl";

import { desk, phone } from "@/test/layout";
import { Ground, locales, Screen, screens, type Theme, themes } from "@/test/screens";

import { AuthScreen } from "@/components/auth/auth-screen";
import { LoginForm } from "@/components/auth/login-form";

/**
 * **Every word on every screen, over the ground it is really drawn on, in both themes.**
 *
 * The repaint moves every token value at once, which is the one change that can cost a
 * screen its legibility without touching that screen's file. A palette is checked by eye
 * against the two or three surfaces somebody remembers to look at; this walks all of
 * them, at both widths, in both themes, and reports the worst.
 *
 * **It asserts a property, not a value.** No token is named here and no pixel is compared
 * to a baseline — the values are deliberately free to move, and what is pinned is only
 * that whatever they move to stays readable. A palette that fails this is not a palette
 * anybody wanted.
 *
 * **The ground is composited, not read.** Half the surfaces in this app are washes —
 * `--signal-wash` is the signal hue at a tenth — so the colour behind a word is the stack
 * of translucent layers between it and the nearest opaque one, and the word's own colour
 * may be translucent over that. Both are flattened the way the compositor does it,
 * through a canvas, so the ratio is the one a reader's eye actually gets.
 *
 * **Both widths, because a hidden element is not measured.** The walk skips anything with
 * no box, which is how it avoids reporting on a `md:` control that the phone never draws
 * — and would be how the desk's app bar and the dense working sheet went unchecked
 * forever if this stood only at 390px.
 */

// Hoisted per file and therefore not shareable, the way every other renderer of
// `@/test/screens` declares its own. See the note in that file.
vi.mock("@/app/actions/auth", () => ({
  signOutAction: async () => ({}),
  signInAction: async () => ({}),
}));
vi.mock("@/app/actions/admin", () => ({
  inviteAction: async () => ({}),
  setWecomUseridAction: async () => ({}),
  sendTestMentionAction: async () => ({}),
  setMembershipDisabledAction: async () => ({}),
  setGroupRobotAction: async () => ({}),
  setFxBufferAction: async () => ({}),
}));
vi.mock("@/app/actions/locale", () => ({ switchLocale: async () => ({}) }));
vi.mock("@/app/actions/theme", () => ({ switchTheme: async () => ({}) }));
vi.mock("@/app/actions/tenders", () => ({
  addAssigneeAction: async () => ({}),
  removeAssigneeAction: async () => ({}),
}));
vi.mock("@/app/actions/quotes", () => ({
  createQuoteAction: async () => ({}),
  updateQuoteAction: async () => ({}),
  deleteQuoteAction: async () => ({}),
  recordNoSupplierFoundAction: async () => ({}),
  clearNoSupplierFoundAction: async () => ({}),
}));
vi.mock("@/app/actions/quote-photos", () => ({
  recordQuotePhotosAction: async () => ({}),
  removeQuotePhotoAction: async () => ({}),
  signQuotePhotoUploadsAction: async () => ({}),
}));

/**
 * WCAG 2.2's minimums, which are the floor this app is held to rather than a target.
 *
 * 4.5:1 for body text and 3:1 for text large enough to survive less — 24px, or 18.66px at
 * bold, the standard's own allowance, stated here rather than assumed because this app's
 * headings are 21px and therefore do *not* get it.
 *
 * 3:1 again for the boundary of a field, under 1.4.11: the hairline round an input is how
 * a reader knows it is an input, so it is information and not decoration. The rules
 * *between* rows are decoration — they separate what is already separated by position —
 * and are deliberately not held to this, which is why the walk asks controls only.
 */
const bodyText = 4.5;
const largeText = 3;
const controlBoundary = 3;

/** Both widths every screen is read at: the phone in the webview, and the Owner's desk. */
const widths = [phone, desk];

describe.each(themes)("the %s theme", (theme) => {
  // The layout project's viewport is the phone and every other suite in it depends on
  // that, so whatever this does to the window is undone before the next file runs.
  afterEach(async () => {
    await page.viewport(phone.width, phone.height);
  });

  it.each(
    locales.flatMap(([locale, messages]) =>
      Object.entries(screens(messages)).map(
        ([name, entry]) =>
          [`${name}, in ${locale}`, locale, messages, entry.body] as const,
      ),
    ),
  )("is legible on %s", async (name, locale, messages, body) => {
    const { container } = render(
      <Screen theme={theme} locale={locale} messages={messages}>
        {body}
      </Screen>,
    );

    await expectLegible(container, theme, name);
  });

  /**
   * The screens reached *before* signing in, which the record above does not hold: they
   * have no `(app)` shell, so they compose `AuthScreen` directly rather than `Screen`.
   * They are repainted by the same tokens as everything else and were the half of #130's
   * *"and the signed-out ones"* that nothing would otherwise have measured.
   *
   * `LoginForm` inside it for the reason its own suite gives: it is the busiest of the
   * three forms, and a column measured around nothing measures nothing.
   */
  it.each(locales)("is legible on the sign-in screen, in %s", async (locale, messages) => {
    const { container } = render(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
        <Ground theme={theme}>
          <AuthScreen
            title={messages.login.title}
            description={messages.login.description}
          >
            <LoginForm />
          </AuthScreen>
        </Ground>
      </NextIntlClientProvider>,
    );

    await expectLegible(container, theme, `the sign-in screen, in ${locale}`);
  });
});

/** Everything this screen drew, at every width it is read at, held to the floors above. */
async function expectLegible(
  container: HTMLElement,
  theme: Theme,
  name: string,
): Promise<void> {
  for (const width of widths) {
    await page.viewport(width.width, width.height);

    expectGroundIs(theme, container, name);

    const words = readable(container);

    // A screen that drew nothing, or a filter that stopped matching anything, would
    // otherwise report a clean bill of health for every case in this file at once.
    expect(words.length, `${name} at ${width.width}px drew nothing to read`).toBeGreaterThan(0);

    const failures = [
      ...words.map(readableFault),
      ...[...container.querySelectorAll<HTMLElement>("input, select, textarea")].map(
        boundaryFault,
      ),
    ].filter((fault) => fault !== null);

    expect(failures, `${name} at ${width.width}px`).toEqual([]);
  }
}

/**
 * That the theme under test is the theme being drawn.
 *
 * Without this the two runs are told apart by a class string on a wrapper, and a `.dark`
 * that stopped applying — renamed, moved to a `data-` attribute — would measure the light
 * palette twice and report the dark theme green. Which is the exact fault the dark block
 * is most exposed to, since nothing in the app turns it on yet.
 *
 * A light ground is nearer white than mid-grey and a dark one is nearer black; that is the
 * whole of the claim, and it names no value.
 */
function expectGroundIs(theme: Theme, container: HTMLElement, name: string): void {
  const ground = luminance(flatten(backgrounds(container.firstElementChild as HTMLElement)));

  if (theme === "dark") expect(ground, `${name} is not dark`).toBeLessThan(0.2);
  else expect(ground, `${name} is not light`).toBeGreaterThan(0.5);
}

/** Why this element's words are unreadable where they are drawn, or `null` if they are not. */
function readableFault(element: HTMLElement): string | null {
  const style = getComputedStyle(element);
  const ground = flatten(backgrounds(element));
  const ratio = contrast(flatten([...backgrounds(element), style.color]), ground);
  const floor = isLarge(style) ? largeText : bodyText;

  if (ratio >= floor) return null;

  return `${ratio.toFixed(2)}:1 (needs ${floor}) — ${describeElement(element)}`;
}

/** The same, for the hairline that tells a reader where a field is. */
function boundaryFault(control: HTMLElement): string | null {
  const style = getComputedStyle(control);
  const width = Number.parseFloat(style.borderTopWidth);

  // A control drawn without a boundary is identified some other way — a filled button, a
  // checkbox with its own glyph — and 1.4.11 has nothing to say about a line that is not
  // there.
  if (width === 0 || alphaOf(style.borderTopColor) === 0) return null;

  const behind = flatten(backgrounds(control.parentElement!));
  const ratio = contrast(flatten([...backgrounds(control.parentElement!), style.borderTopColor]), behind);

  if (ratio >= controlBoundary) return null;

  return `${ratio.toFixed(2)}:1 (needs ${controlBoundary}) — the edge of ${describeElement(control)}`;
}

/**
 * Every element drawing words of its own.
 *
 * Its *own* text nodes, not its descendants': a card whose text is all in children is not
 * itself drawing anything, and counting it would measure the card's colour against the
 * card's background and call it a pass.
 *
 * A disabled control is left out, as WCAG leaves it out. Nothing else is: an element too
 * small to see is still an element somebody meant to be read.
 */
function readable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("*")].filter(
    (element) =>
      element.getClientRects().length > 0 &&
      element.matches(":not(:disabled)") &&
      [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() !== "",
      ),
  );
}

function isLarge(style: CSSStyleDeclaration): boolean {
  const size = Number.parseFloat(style.fontSize);

  return size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
}

/**
 * The layers between this element and the nearest opaque surface, bottom-first.
 *
 * The walk stops at the first background that is fully opaque, because nothing below it
 * reaches the eye. If it reaches the top without finding one — which no screen in this app
 * does, since the ground carries one — {@link flatten} paints on white, the last resort a
 * browser itself would use.
 */
function backgrounds(element: HTMLElement): string[] {
  const layers: string[] = [];

  for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
    const colour = getComputedStyle(node).backgroundColor;
    const alpha = alphaOf(colour);

    if (alpha === 0) continue;

    layers.unshift(colour);

    if (alpha === 1) break;
  }

  return layers;
}

const paint = document.createElement("canvas").getContext("2d", {
  willReadFrequently: true,
})!;

/**
 * A stack of possibly-translucent colours as the one colour a reader sees.
 *
 * Composited by the canvas rather than in arithmetic here, so that every colour syntax the
 * stylesheet may use — `oklch()` today, whatever it moves to tomorrow — is resolved by the
 * same engine that paints the page. A colour the canvas cannot parse would silently keep
 * the previous fill, so each layer is checked to have actually taken.
 */
function flatten(layers: string[]): [number, number, number] {
  paint.clearRect(0, 0, 1, 1);
  paint.fillStyle = "#ffffff";
  paint.fillRect(0, 0, 1, 1);

  for (const layer of layers) {
    paint.fillStyle = "#ff00ff";
    paint.fillStyle = layer;

    expect(paint.fillStyle, `the canvas could not parse ${layer}`).not.toBe("#ff00ff");

    paint.fillRect(0, 0, 1, 1);
  }

  const [red, green, blue] = paint.getImageData(0, 0, 1, 1).data;

  return [red, green, blue];
}

function alphaOf(colour: string): number {
  paint.clearRect(0, 0, 1, 1);
  paint.fillStyle = colour;
  paint.fillRect(0, 0, 1, 1);

  return paint.getImageData(0, 0, 1, 1).data[3] / 255;
}

/** WCAG 2.2's contrast ratio, on two colours already flattened to plain sRGB. */
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (lighter + 0.05) / (darker + 0.05);
}

function luminance([red, green, blue]: [number, number, number]): number {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const value = channel / 255;

    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Enough of the offending element to find it: what it is, and the words it drew. */
function describeElement(element: HTMLElement): string {
  const words = [...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent?.trim())
    .join(" ");

  return `<${element.localName}> ${words.slice(0, 60)}`.trim();
}
