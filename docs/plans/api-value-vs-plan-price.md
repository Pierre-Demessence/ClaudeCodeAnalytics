# API value vs plan price

## Goal

Show what the subscription was charged next to what the same usage would have cost at API prices, on the Usage tab.

## Acceptance criteria

- WHEN there is usage, THE SYSTEM SHALL show Subscription, API value and Saved ($ and % below API) for the current billing cycle and for all time.
- WHILE the billing date is unknown, THE SYSTEM SHALL prorate the list price by time over the last 4 weeks and since the first message.
- WHEN the plan changed, THE SYSTEM SHALL price each billing date at the plan then active.

## Checklist

- [x] `core/valueForMoney.ts`, wired into `buildSummary`
- [x] `collector/account.ts`: `subscriptionStartedAt` into `status.json`
- [x] `ValueCard` on Usage
- [x] Docs: README, AGENTS.md, decisions, backlog; roadmap item removed
