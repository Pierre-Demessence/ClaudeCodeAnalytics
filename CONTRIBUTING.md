# Contributing

Thanks for helping. Bug reports, ideas and pull requests are all welcome; this
page says how to make a pull request easy to merge.

## Before you start

- **Small fixes** (a bug, a typo, a wrong number): open the pull request directly.
- **Anything bigger** (a new card, tab, setting or data field): open an issue
  first, or comment on an existing one, so we agree on the approach before you
  spend time on it.
- [`docs/backlog.md`](docs/backlog.md) lists known bugs and ideas, and
  [`docs/decisions.md`](docs/decisions.md) explains choices that may look odd
  (why the endpoint is opt-in, why the token is never refreshed, …). Read the
  relevant entry before proposing to change one of those.

## Setup

Requires Node ≥ 22.18. The taskbar widget also needs Windows, Rust
(`mise install`) and the Docker dashboard running behind Traefik, which it polls;
its tests run without them.

```sh
npm install
npm run dev # dashboard with hot reload
```

**Keep your own history safe.** The collector writes to
`~/.claude-code-analytics/` by default. For manual tests, point it at a scratch
folder with `CCA_DATA_DIR`. And if you installed the hook from this clone, it
runs your working copy after every Claude Code response: a broken collector
fails silently there (see "Last run failed" in the Calibration tab's Collection
card).

## Making a change

[`AGENTS.md`](AGENTS.md) holds the project's conventions: layout, imports,
tests, theming, tooltips, charts. It is written for AI agents but applies to
everyone. The rules that matter most in review:

- **Privacy.** Never store message content, tool inputs or anything from
  `~/.claude.json` beyond `subscriptionCreatedAt`. The OAuth token stays in
  memory and goes only to `api.anthropic.com`. If your change reads a new file
  or field, update the "Privacy" table in the README in the same pull request.
- **No new network calls**, and no retry loop on the usage endpoint: it shares a
  rate limit with Claude Code's own `/usage`.
- **Accessible charts.** Never carry meaning by color alone (pair it with a
  pattern, icon or text), check both light and dark themes, and use `useTip()`
  instead of the `title` attribute.
- **Anonymize mode.** A new field showing a project, path, branch or
  conversation title goes through `anonymizeSummary` (`anonymizeRanged` for the
  history tabs).
- **Tests.** Logic in `src/core/` gets unit tests next to it; a bug fix starts
  with a test that fails without the fix.

### Docs to update

| If your change… | Update |
| --- | --- |
| Changes what users see or do | `README.md`, if it describes it |
| Reads a new file or field | The README's "Privacy" table |
| Completes a backlog item | Delete it from `docs/backlog.md` |
| Finds a bug or idea you won't fix now | Add one line to `docs/backlog.md` |
| Makes a choice someone would question | `docs/decisions.md` |
| Changes commands, layout or conventions | `AGENTS.md` |

Docs describe how things are now: no "previously", dates or changelog lines;
git keeps the history. The full rules are in the "Docs" section of `AGENTS.md`.

## Pull requests

1. Run the checks CI runs, and make sure they pass:

   ```sh
   npm run lint
   npm test
   npm run build
   ```

   If you touched `widget/`, also run `npm run widget:test` on Windows; CI runs
   it too.
2. Keep one topic per pull request. Commit messages follow
   [Conventional Commits](https://www.conventionalcommits.org/)
   (`fix(dashboard): …`, `feat(collector): …`).
3. Fill in the pull request template: a short summary of what changed and why,
   and a test plan (what you ran, what you checked by hand). For UI changes, add
   screenshots in light and dark, with anonymize mode on if they show your
   projects.

### Using an AI agent

Welcome, with the same bar as hand-written code: you have read and understood
the diff, and the checks pass. Most agents (Claude Code, Codex, Copilot,
Cursor, …) load `AGENTS.md` on their own; point yours at this file too before
it opens a pull request.

## Security

Found a way the tool could leak data or the token? Don't open a public issue:
see [`SECURITY.md`](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
