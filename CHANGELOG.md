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
- The Weeks tab shows each week on the plan it ran on, and judges on that plan
  whether the week hit the limit. After the upgrade from Pro to Max 5×, a Pro week
  at its limit read 20% on a fifth of a bar, without its mark; it reads 100% on a
  full bar, and its estimate without the limit and the typical-week tick are on Pro
  too, as their tooltips say. After a downgrade, weeks far from their limit could
  gain a mark. A week whose usage restarted still adds its parts up on your current
  plan, like the median peak. The legend no longer repeats the median, which the
  median peak card shows.
- The Sessions tab shows a 5-hour window without a reading on the plan it ran on,
  like the windows with one: after the upgrade from Pro to Max 5×, the estimated
  Pro windows read about a fifth of their %.
- A week without readings, estimated from transcripts, stops at the limit of the
  plan it ran on and finds the point where its limit got close (90%) on that plan.
  After an upgrade, a Pro week estimated this way never reached 90% of Max 5×, so
  the plan comparison never filled the time its limit hid.
- The plan comparison no longer counts the week your oldest transcript falls in as
  a light week: its days before that transcript are filled at your typical pace,
  like the days before you subscribed, and the Weeks tab says why.
- The weekly forecast's typical pace starts again only at a plan change. A plan
  period that keeps the plan, such as the one recorded when you turn the usage
  endpoint on, made it forget the days before it for the next four weeks.
- The weekly projection, the active use left and the room per day count the usage
  since the last reading even while that reading is under 30 minutes old (the card
  still shows it as read). They left out up to half an hour of usage.
- After a plan change, the 5-hour forecast takes its typical session pace from
  the sessions under the new plan once there are 3, as the weekly forecast does:
  the sessions a smaller plan's limit cut short held it down.
- The Usage tab's costliest messages say "after a pause" when the main
  conversation waited while a subagent worked: the subagent's messages hid the
  pause, though it keeps a cache of its own.
- The active use left for a model you use too little to measure prices your usual
  tokens on that model. It scaled by the output price alone, while cache reads are
  most of the cost and their price differs: Fable 5.1 output costs 2.5 times Opus
  5.5's, its cache reads 1.25 times.
- The active use left on the limit cards stops at the reset: a 5-hour window
  resetting in 30 minutes could show more active use left than it has time.
- The cache card's "saved" takes off what the cache writes cost beyond plain
  input (a quarter more for 5 minutes, double for an hour): it counted only what
  the cache reads saved.
- A cache flush's extra cost counts only the tokens written again, the previous
  prompt, and no longer the turn's new tokens, which a live cache writes too.
- A write to the data dir that fails no longer leaves its temp file there, such
  as `messages-2026-10.jsonl.<pid>.<id>.tmp`. One left by an earlier version can
  be deleted.
- A week whose plan changed without its usage restarting (a downgrade that keeps
  the week's usage, say) reads the point where its limit got close (90%) on the
  plan of that reading, not on the plan of the week's last reading: the plan
  comparison read 92% of Max 5× as 92% of Pro.
- Readings of one week whose reset times differ by a minute or two (the endpoint
  rounds them to the minute, which can tip either way) count as one week. Such a
  week showed twice in the Weeks tab and the typical week, and a restart between
  two of its readings went unseen.
- On a phone, the Weeks tab's median peak card wraps its estimate without the
  limit instead of running past the card's edge.
- On the Sessions tab, the "now" line no longer runs through the % of the window
  in progress ("3|1%"): it passes behind the label, also while another window is
  highlighted.

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
