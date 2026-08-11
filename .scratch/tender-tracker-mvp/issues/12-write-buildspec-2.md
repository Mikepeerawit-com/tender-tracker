# 12 — Write buildspec_2.md

Type: task (AFK)
Status: open
Blocked by: 11

## Question

The destination. Synthesise every resolved ticket into a rewritten **`buildspec_2.md`** at the repo root.

**Hard requirement: it must be readable standalone.** A fresh Claude Code session with no access to this map, these tickets, or this conversation must be able to build from it. "See ticket 04" is a failure. Restate decisions in full; the tickets are provenance, not required reading.

Must contain:

- **Data model** carrying the cardinality from 01, any currency columns from 04, any lifecycle/date columns from 05, and any identity/linking columns from 07. Complete DDL-level detail — table, column, type, nullability, enum values.
- **Auth plan** from 07, including how the first accounts are created.
- **Notification design** from 08 (or its absence, if 11 cut it — with the deferral noted).
- **Screens** as cut by 11, with the comparison view (09) and dashboard (10) described at the fidelity their prototypes reached. Link the prototypes.
- **Hosting decision** from 03, with the reasoning, since it is the kind of thing a future reader will otherwise reverse by accident.
- **A "deferred / not in v1" section** carrying 11's deferrals *with their reasons*.
- **An explicit assumptions section.** Every claim traces to a resolved ticket or is marked an assumption. No unmarked guesses — that is the entire point of this map.

Also carry forward from `buildspec_1` the things that were never in question (Tailwind + shadcn/ui, next-intl, the key behaviour notes about per-quote photos and computed margin) — de-risking the risky parts doesn't mean losing the settled ones.

When this ticket closes, the map is complete.

---

## Correction: use `/to-spec`, don't hand-roll this

Wayfinder's documented hand-off is **`/to-spec`** — it exists to collapse a map's linked decisions into a buildable plan, which is exactly this ticket's job. Invoke it rather than writing the synthesis freehand; the requirements above then become the acceptance criteria for its output, not a separate procedure.

After it: **`/to-tickets`** to split the spec into tracer-bullet implementation tickets with blocking edges, then **`/implement`** per ticket, clearing context between each. Do **not** loop this map straight into `/implement` — that skips the collapse and throws the linked decision detail away.
