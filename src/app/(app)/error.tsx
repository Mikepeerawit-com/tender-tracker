"use client";

import { ScreenError } from "@/components/ui/screen-error";

/**
 * The error boundary for everything behind the login.
 *
 * It wraps `loading.tsx`, `not-found.tsx`, `page.tsx` and every nested layout under
 * `(app)` — but *not* `(app)/layout.tsx` itself, which is above it in the same segment.
 * That is the right split: the layout's only failure mode is `currentUser`, which
 * redirects rather than throws.
 *
 * **`retry`, not `reset`.** The prop was renamed and `retry` became stable in Next 16.3,
 * which is the version in this repo's `package.json`; see
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`.
 * `reset` still exists and does less — it re-renders the children without re-fetching
 * them, which for a screen that threw on a Supabase read is a retry that cannot succeed.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ScreenError digest={error.digest} retry={retry} />;
}
