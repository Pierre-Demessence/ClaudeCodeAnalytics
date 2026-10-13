# Anonymize toggle

## Goal

A header button that replace project names, `cwd` paths, branches and
conversation titles with stable placeholders in every view, so the dashboard can be
screenshotted without leaking them. Last item of the roadmap's "Next" list, so it masks
every view added before it.

## Acceptance criteria

- WHEN the user presses the toggle button, THE SYSTEM SHALL switch anonymize mode and show the new state on the button (`aria-pressed`, icon change and label, not color).
- WHILE anonymize mode is on, THE SYSTEM SHALL show no project name, path, branch or conversation title anywhere in the dashboard, tooltips included.
- WHILE anonymize mode is on, THE SYSTEM SHALL show the same placeholder for the same real value in all views (e.g. "Project 2" is the same project in By project, Sessions and Weeks), numbered by first appearance in the summary.
- WHEN the page reloads, THE SYSTEM SHALL keep the mode (`localStorage`, key `cca-anonymize`); IF storage throws, THEN THE SYSTEM SHALL keep the mode for the page only.
- THE SYSTEM SHALL leave the API, the data dir and the widget untouched (display-only).

## Design

- **Mask the data, not the render sites.** A pure `anonymizeSummary(summary): Summary` in
  `src/dashboard/anonymize.ts` rewrites the name fields once in `App.tsx`; every present
  and future view receives masked data, and a test can assert that no original string
  survives anywhere in the JSON (deterministic, instead of eyeballing each view).
  Rejected: a `<Mask>` component at each site; a new view would leak until someone
  remembers to wrap it.
- Fields to cover (found by grepping the summary types for `name`, `path`, `title`,
  `branch`, `project`): `breakdown.projects`, `breakdown.conversations`, the
  `projects` of sessions windows and weeks, `MessageCostCard` outliers. `status.lastError` is dropped (Node errors quote absolute paths). Skill, tool and
  subagent-type names are not project data and stay.
- Placeholders: `Project N` (name and path both, since the path is shown only in tips),
  `Conversation N` for titles, `branch N` for branches. Maps are built per call, in
  order of first appearance.
- State: `useAnonymize()` next to `theme.ts` (same storage pattern, try/catch).
- Button in `Header.tsx` beside the theme button: Lucide `EyeOff` when on, `Eye` when
  off, tooltip via `useTip()`.
- Claude Design: not worth a canvas, one icon button beside an existing one.
- Edge: a value that is `undefined` (conversation without a title) stays `undefined`, so
  the "no title" layout is still shown.

## Checklist

- [x] Find every name-bearing field in the summary types and the views (grep, list in this plan)
- [x] `anonymize.ts` with tests (stable numbering, shared across views, no original string left, undefined kept)
- [x] `useAnonymize` with tests (storage, throwing storage)
- [x] Header button and wiring in `App.tsx`, with tests
- [x] Remove the item from `docs/backlog.md` and `docs/roadmap.md`; update `AGENTS.md` (conventions: new views must get names from the masked summary)
- [x] lint, test, build; check in a real browser (dark theme only)
- [x] Review pass (3 findings fixed: lastError leak, test path escapes, plan text)

Status: implemented and verified; light-theme check left.
