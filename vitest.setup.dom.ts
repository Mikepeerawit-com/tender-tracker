import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Unmount what the last test rendered.
 *
 * Testing Library registers this itself when the test globals are on the global object.
 * They deliberately are not here — `describe`, `it` and `expect` are imported in every
 * test file in this repo — so the registration is done by hand instead of quietly not
 * happening, which would leave each test asserting against the previous test's DOM.
 */
afterEach(cleanup);
