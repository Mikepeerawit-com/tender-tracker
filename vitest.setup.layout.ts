import "./vitest.setup.dom";

/**
 * `process`, for the one dependency in the tree that expects to be bundled by Next.
 *
 * `next/link` reads `process.env.__NEXT_ROUTER_BASEPATH` while its module is still
 * evaluating, and Next's own build replaces that expression at compile time. Vite serves
 * the module untouched to a real browser, where there is no `process` at all — so the
 * sheet's layout could not be measured without this, over a variable whose absence is the
 * whole answer anyway.
 */
globalThis.process ??= { env: {} } as typeof globalThis.process;
