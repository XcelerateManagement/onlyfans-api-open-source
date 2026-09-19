# Changelog

Releases are published at
[github.com/theonlyapi/onlyfans-api/releases](https://github.com/theonlyapi/onlyfans-api/releases),
which is the canonical record. This file summarises them.

## How to read a version

`0.x` semantic versioning, with one project-specific meaning that answers the only
question a self-hoster actually has about an upgrade:

- **Patch** (`0.1.0` → `0.1.1`) — `git pull && docker compose build && docker compose up -d`.
  Nothing else to do.
- **Minor** (`0.1.x` → `0.2.0`) — **you have to do something**: a new required
  environment variable, a schema change worth backing up before, or a compose change.
  The release notes open with an "Operator actions required" section.

Release notes carry fixed sections, with empty ones removed: **Operator actions
required** · **Platform fixes** · **API** · **Dashboard** · **Packaging & deploy** ·
**Security**.

Anything fixing a platform breakage is tagged within days and its release title is
prefixed `⚠️ Upgrade now —`. Watching releases is the intended way to hear about those.

## Unreleased

First public release in preparation.
