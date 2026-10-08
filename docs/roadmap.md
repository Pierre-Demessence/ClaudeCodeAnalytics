# Roadmap

Order of the redesign milestones (design:
<https://claude.ai/artifact/Fw9e29WbgMikfa9CK5WyfV>). Each milestone gets its own
plan in `docs/plans/` and is deleted from here when done. The items themselves
live in `docs/backlog.md`. A tab's milestone is done only when the whole tab
matches its design artboard, existing views included.

## Transcript forensics

Order; the items are tagged `[forensics]` in the backlog.

1. **Where tokens go**: output tokens by tool and cost per skill or slash
   command. Both need tool names per message, so they share one `SCAN_FORMAT`
   bump. Done when Breakdown shows the split and every figure sums to the
   output total.
2. **Small additions**: subagent types, anonymize toggle, project drill-down,
   API-equivalent value vs plan price.
