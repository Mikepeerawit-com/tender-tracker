import { expect } from "vitest";

/**
 * **What a reader's eye actually gets**, for the browser suites that ask about colour.
 *
 * Half the surfaces in this app are washes — `--signal-wash` is the signal hue at a tenth
 * — so the colour behind a word is the stack of translucent layers between it and the
 * nearest opaque one, and the word's own colour may be translucent over that. Nothing here
 * reads a token: every value comes off a rendered element and is composited the way the
 * compositor does it, so the ratio is the one the screen produced rather than one
 * recomputed from the stylesheet.
 *
 * It began inside `contrast.layout.test.tsx`, which was the only file that asked. #135
 * gave it a second reader in `focus.layout.test.tsx` — a focus ring is the same question
 * about a different colour — and a second copy of a compositor is a second place for the
 * two suites to disagree about what a reader sees.
 *
 * **Colour and nothing else.** Naming the offending element in a failure message is a
 * separate need with three readers rather than two, so it lives in `@/test/layout`
 * alongside the other describer it would otherwise collide with.
 */

const paint = document.createElement("canvas").getContext("2d", {
  willReadFrequently: true,
})!;

/**
 * A stack of possibly-translucent colours as the one colour a reader sees, bottom-first.
 *
 * Composited by the canvas rather than in arithmetic here, so that every colour syntax the
 * stylesheet may use — `oklch()` today, whatever it moves to tomorrow — is resolved by the
 * same engine that paints the page. A colour the canvas cannot parse would silently keep
 * the previous fill, so each layer is checked to have actually taken.
 *
 * White is the last resort, which is the one a browser itself would use: a stack that
 * reaches the top of the document without finding an opaque surface has nothing else to
 * be over.
 */
export function flatten(layers: string[]): [number, number, number] {
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

/**
 * The layers between this element and the nearest opaque surface, bottom-first.
 *
 * The walk stops at the first background that is fully opaque, because nothing below it
 * reaches the eye. If it reaches the top without finding one — which no screen in this app
 * does, since the ground carries one — {@link flatten} paints on white.
 */
export function backgrounds(element: HTMLElement | null): string[] {
  const layers: string[] = [];

  for (let node = element; node !== null; node = node.parentElement) {
    const colour = getComputedStyle(node).backgroundColor;
    const alpha = alphaOf(colour);

    if (alpha === 0) continue;

    layers.unshift(colour);

    if (alpha === 1) break;
  }

  return layers;
}

/** The one colour a reader sees behind this element, its own background included. */
export function groundUnder(element: HTMLElement | null): [number, number, number] {
  return flatten(backgrounds(element));
}

export function alphaOf(colour: string): number {
  paint.clearRect(0, 0, 1, 1);
  paint.fillStyle = colour;
  paint.fillRect(0, 0, 1, 1);

  return paint.getImageData(0, 0, 1, 1).data[3] / 255;
}

/** WCAG 2.2's contrast ratio, on two colours already flattened to plain sRGB. */
export function contrast(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (lighter + 0.05) / (darker + 0.05);
}

export function luminance([red, green, blue]: [number, number, number]): number {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const value = channel / 255;

    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
