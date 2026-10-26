# Changelog

Noteworthy changes for users. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Right after a plan change, the projections borrow the previous plan's ratio,
  converted with the advertised limits, until the new plan has 3 readings of its
  own; the Calibration tab says so.

### Fixed

- The weekly forecast and "Room left" no longer understate a heavy week. The
  current week uses its own % per dollar once it has 3 readings, the typical pace
  comes from the days under your current plan, the days left are projected as a
  resampled total instead of the median day times the days left, and over the
  week's first 3 days the projection moves to the week's own pace.
- A week in which your usage restarts (a plan change, a free reset) is no longer
  left out. It is split where the usage restarted: the forecast, the pacing and
  the fits count from the restart, the earlier part is drawn on the pacing chart,
  and the week's peak adds its parts up in the typical week, the median peak and
  the plan comparison. The Weeks tab marks such a week and lists its parts.
- The 5-hour window from before an upgrade now ends where the new one starts, so
  the usage after an upgrade no longer lands in the old window, and the Plans tab
  no longer counts the estimated sessions of an earlier plan too small.
- Sonnet 5.5 cache reads are priced at their list price, $0.10 per million tokens
  instead of $0.20. Sonnet 5.5 usage costs less in every dollar figure, and moving
  Opus 5.5 work to Sonnet 5.5 on the Plans tab saves half of its cost, as the list
  prices say.
- Claude Haiku 5.5 is priced: its messages counted as $0 and the model was listed
  as unknown. A request whose prompt is over 100,000 tokens, cache included, pays
  its higher prices.
- "All time" on the Subscription card no longer counts the billing cycles that
  ended before your oldest transcript: Claude Code deletes transcripts after 30
  days, so a subscription older than that set months of charges against one month
  of usage.

## [0.2.0]

### Changed

- **The Claude Code hook now needs the always-on Docker dashboard.** After every
  response it asks the container to import new transcripts, instead of running
  the collector from your clone. Checking out a branch (a pull request's, say)
  can no longer run its code automatically as you. If the container is down,
  the hook does nothing and the next run catches up; without Docker, opening the
  dashboard imports new transcripts. **Run `npm run hook:install -- --apply`
  again** to replace the old hook, and `npm run docker:up` after updating.
- Settings are saved together: every field is a draft until Save, with Discard
  beside it. Invalid values are explained under their field, a failed save keeps
  your edits, and the limit thresholds move to an Advanced section.
- Turning the usage endpoint on asks for confirmation first, saying what happens
  with your login token.

### Added

- Edit the start of a plan period from the plan history; an edited period
  becomes manual.
- Upgrades are billed as Anthropic invoices them: a new billing cycle starts at
  once, at the new plan's price minus a credit for the unused time, shown under
  the price in the Subscription card.
- Billing starts at the first plan period when you set it by hand, since the
  account's subscription date can predate the first payment.

### Fixed

- Settings fields no longer lose focus mid-typing when the dashboard reloads in
  the background.
- A check interval edited and then hidden (endpoint turned back off) no longer
  keeps the Save bar up.
- A plan period's start edit stays open with what you typed when its save fails.

## [0.1.0]

First public version: limit forecasts for the 5-hour and weekly windows, budget
pacing, subscription vs API prices, usage breakdowns, past sessions and weeks,
which plan fits your usage, a Windows taskbar widget and an always-on Docker
setup.

[Unreleased]: https://github.com/Pierre-Demessence/ClaudeCodeAnalytics/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Pierre-Demessence/ClaudeCodeAnalytics/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Pierre-Demessence/ClaudeCodeAnalytics/releases/tag/v0.1.0
