# Roadmap

Order of the redesign milestones (design:
<https://claude.ai/artifact/Fw9e29WbgMikfa9CK5WyfV>). Each milestone gets its own
plan in `docs/plans/` and is deleted from here when done. The items themselves
live in `docs/backlog.md`. A tab's milestone is done only when the whole tab
matches its design artboard, existing views included.

1. **Collect the new transcript fields**: session, subagent flag, effort,
   thinking tokens, entrypoint, git branch, working directory and Claude Code
   version on every stored message, with a one-time rescan of the transcripts
   still on disk. No new views. First because transcripts are deleted after
   `cleanupPeriodDays`: fields not collected are lost with them.
2. **Breakdown tab**: by project, most expensive conversations, main agent vs
   subagents, effort and thinking, surface and branch. Done when the tab matches
   its board. Periods: this week (default), last 4 weeks, all time. A project
   is a working directory, compared without the drive letter's case (it varies
   within one session); a project name is the directory's last segment, the
   full path as tooltip. The period selector reuses the toggle from
   `RawUsage.tsx`; on phones the model bar goes under the project name.
3. **Usage tab**: the existing daily/weekly chart restyled to the design, plus
   the weekday × hour heatmap, cache efficiency, cost per message with
   outliers, and Claude Code upgrades marked on the daily chart.
4. **Sessions tab**: past 5-hour sessions timeline and list.
5. **Calibration tab**: the existing settings, readings and status restyled to
   the design, plus limit drift, Claude Code vs claude.ai split, what-if
   simulator, deleting manual readings, Claude Code share in the manual form.
