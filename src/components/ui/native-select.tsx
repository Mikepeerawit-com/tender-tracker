import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The platform's own `<select>`, styled to sit beside `Input`.
 *
 * Deliberately not shadcn's `Select`, which is a listbox built out of divs. On a phone
 * the native control opens the OS picker — one thumb, no scroll trapping — and inside
 * the WeCom webview, where every reminder link lands, that is the control most likely
 * to behave. The name keeps the file out of the way of a future `shadcn add select`.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:border-destructive/50",
        className
      )}
      {...props}
    />
  )
}

export { NativeSelect }
