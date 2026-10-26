# Changelog

Noteworthy changes for users. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Failed collector writes clean up their temporary files instead of leaving them
  in the data directory.
- The weekly forecast and "Room left" no longer understate a heavy week. The
  current week uses its own % per dollar once it has 3 readings, the typical pace
  comes from the days under your current plan, the days left are projected as a
  resampled total instead of the median day times the days left, and over the
  week's first 3 days the projection moves to the week's own pace.
- A week in which you change plans no longer skews the forecasts and the plan
  comparison: its peak % covers only the new plan's part of the week. Such a week
  is marked on the Weeks tab and left out of the calibration, the typical week,
  the median peak and the plan comparison.

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
