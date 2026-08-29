/**
 * The viewport ADR-0009 states its failure bar at: 390×844, an iPhone 14/15 in CSS
 * pixels.
 *
 * It is its own module, and a `.mts` one, because it has two consumers that cannot share
 * anything heavier: `vitest.config.mts` sets the browser instance to it, and
 * `@/test/layout` names it in every `describe` title. Held in one place, those two cannot
 * drift — a config narrowed to 360 would otherwise leave four suites announcing a width
 * they were no longer measuring at.
 */
export const phone = { width: 390, height: 844 };

/**
 * The browser window the contact sheet is captured in (#78).
 *
 * Vitest scales the test iframe down to fit the window, and a scaled screenshot is a
 * picture of the wrong pixels — 390px of layout reported as 333. So the window is given
 * room for the tallest screen at full size, and the capture asserts it stayed inside.
 *
 * Same reason this lives beside `phone`: `vitest.config.mts` sets it and
 * `screens.contact-sheet.tsx` checks against it, and a number those two disagreed about
 * would silently produce a shrunken sheet rather than an error.
 */
export const captureWindow = { width: 1200, height: 3000 };
