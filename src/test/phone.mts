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
