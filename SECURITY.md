# Security policy

Claude Code Analytics reads your Claude Code transcripts and, when the usage
endpoint is on, your OAuth token. A flaw here can expose private data, so
please report it privately.

## Reporting a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/Pierre-Demessence/ClaudeCodeAnalytics/security/advisories/new).
Don't open a public issue or pull request for it.

Include what an attacker can do, how to reproduce it, and the version or commit
you tested. Leave out real tokens and transcript content; a placeholder is enough.

This is a solo project: reports are handled as soon as possible, without a fixed
deadline. You'll get an answer in the advisory, and credit in it if you want.

## Supported versions

Only the latest release and `main` get fixes.

## In scope

- The OAuth token being read while the usage endpoint is off, or being logged,
  stored, refreshed or sent anywhere but `api.anthropic.com`.
- Message content, tool inputs or other data beyond what the README's "Privacy"
  section lists ending up in the data dir, the logs or the API's answers.
- The local API (`/api/*`) being reachable or writable from another origin or
  host (cross-site requests, DNS rebinding, the Docker setup exposing a port).
- The hook installer damaging `~/.claude/settings.json`.

## Out of scope

- Anthropic's own services and endpoints: report those to
  [Anthropic](https://www.anthropic.com/responsible-disclosure-policy).
- Attacks that need the attacker to already run code as you on your machine.
