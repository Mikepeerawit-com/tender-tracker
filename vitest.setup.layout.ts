import { vi } from "vitest";

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

/**
 * **The server actions every screen in `@/test/screens` reaches for**, stubbed once.
 *
 * Every component in that record is presentational and asserts nothing about writes, but
 * a form reaching `useActionState` with an undefined action throws on render, and the
 * action modules themselves import `next/cache`, which has no `__dirname` in a browser
 * and takes the whole file down on import. So each renderer of the record has to answer
 * for all of them, whether or not it draws the screen that presses one.
 *
 * It was six copies of this block until #135 — the layout suites, the density budget, the
 * two switcher suites and the contact sheet — and adding the working sheet to the record
 * meant editing all six before any of them could import it again. That is the fragility
 * the record exists to remove: a screen added to it should confer its guards rather than
 * collect six edits, so the block that is the same in all six lives here, in the setup
 * file both browser projects already load.
 *
 * **What is deliberately still per file** is a stub that is not a stub of convenience: the
 * two switcher suites mock their own action to a promise that never settles, because a
 * spinner has to stay on screen to be measured. A `vi.mock` in a test file is registered
 * after this one and wins, which is what makes those overrides work.
 */
vi.mock("@/app/actions/auth", () => ({
  signOutAction: async () => ({}),
  signInAction: async () => ({}),
  setPasswordAction: async () => ({}),
  chooseLanguageAction: async () => ({}),
}));
// Its own module rather than `auth`, and reached only by the first-admin setup screen.
vi.mock("@/app/actions/setup", () => ({ setUpAction: async () => ({}) }));
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
vi.mock("@/app/actions/comparison", () => ({
  selectQuoteAction: async () => ({}),
  setLandedCostAction: async () => ({}),
  setSellingPriceAction: async () => ({}),
}));
