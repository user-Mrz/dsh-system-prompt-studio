# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Because this plugin binds to internal DSH contracts that carry no stability promise, a version bump
here is a statement about **those contracts**, not only about features: a minor bump means the
integration still targets the same DSH shapes, a major bump means it may not.

## [Unreleased]

Nothing yet.

## [0.3.0] — 2026-11-13

### Added

- **Workspace-level overrides.** There were two scopes — this conversation, and the global default —
  with nothing in between, which is the wrong shape for the most common need: rules that belong to a
  project. "Be terse, this repo has no test suite" had to be re-typed into every conversation opened in
  that directory, or pushed into the global default where it leaks into unrelated work. The panel now has
  a third scope, **This workspace**, keyed on the conversation's current working directory.

  The precedence chain is, from most to least specific: this conversation → inherited from a fork →
  **this workspace** → global default. Workspace sits above the global default because it is narrower;
  below a fork's inherited rules because a fork carries the context of the work it branched from, and a
  rule the user wrote for that specific branch is a more specific statement than the directory's default.

  Two deliberate asymmetries:

  - `workspaceScope` defaults to `all` (subagents included) while `globalDefaultScope` defaults to
    `roots`. A global persona leaking into a tool-shaped subagent pollutes it; a project's rules
    *should* reach the subagents doing that project's work, or the actual workers are the ones not
    following them.
  - `resetAll` clears per-conversation entries and leaves workspace entries alone. Workspace rules are
    accumulated project configuration, not per-conversation scratch state; destroying them behind a
    button labelled "clear all conversation overrides" would be unrecoverable and unexpected.

- **Directory changes are reconciled at assembly time.** `workingDirectory.set` (a user switching a
  conversation to another project) emits no event, so a signature computed at install time would leave
  the old directory's rules in force with nothing to explain it. The assembly listener now recomputes
  each live agent's signature and reinstalls on a mismatch. It runs after the sections are already
  collected, so the current request is unaffected and the change lands on the next one.

### Fixed

- **The workspace key is not `workingDirectory.get()`.** That call returns
  `stateOf(session) ?? defaultDirectory`, so a conversation that never changed directory reports the
  *deployment default* directory rather than its own project. Keying on it directly would have collapsed
  every conversation onto one workspace entry — rules saved in one project applying in another, with
  nothing on screen to explain it. The key now comes from `workspaceRegistry` first (the workspace the
  sidebar shows), then `workingDirectory.get()` **only when it differs from `defaultDirectory`** (i.e. a
  change was really committed), then the session's recorded `header.cwd`.

- **Cold conversations could not use the workspace scope at all.** Resolving the workspace required a
  `Session` object, and a cold conversation is neither a live agent nor in the in-memory session store,
  so the lookup returned nothing: the panel showed "no usable workspace" and a conversation that had not
  been resumed yet could not be given its project's rules. The registry is durable, so its ownership
  lookup now runs on the bare session id alone, and the `Session`-dependent fallbacks are only tried when
  one is actually available. A rule saved from a cold conversation applies to its live siblings
  immediately.

### Security

- **The workspace path is derived on the host, never supplied by the panel.** A workspace save sends a
  `sessionId`; the host resolves that conversation's current directory itself. Accepting an arbitrary
  path from the client would let any same-origin script write rules for directories the user never
  opened — the loopback fence stops remote callers but not injected script. An explicit `workspaceKey`
  field is still accepted when no `sessionId` is given, for scripts and tests, and passes the same
  normalisation.

### Changed

- Workspace keys are normalised paths, not `workspaceRegistry` ids: separators unified, trailing and
  duplicate separators collapsed, `.` segments dropped, case folded on Windows. Re-registering a deleted
  workspace would mint a new id, and a user's project rules should not evaporate because of that. The
  *path* is read from the registry entry; the *id* is deliberately not used as the key.
- An unknown `scope` value still falls back to `session` rather than to `global`. Falling back to
  `global` on a typo would silently rewrite every conversation while the user believes they edited one.

## [0.2.1] — 2026-11-12

### Fixed

- **The section-order table was one DSH release behind.** DSH `0.2.2-rc.2` added two entries to
  `SECTION_ORDERS`: `TOOL_PTY_PANEL` (1710) and `TOOL_COMPUTER_USE` (3000). Neither was in this plugin's
  hardcoded copy, so they were treated as unknown sections and given an interpolated order from their
  neighbours. Nothing failed, but "Replace a section" could not select them and the panel's order column
  drifted for them. Both are now recorded under the names they actually assemble as: `tool:pty-panel`
  (registered by `dsh-terminal-panel`) and `computer-use:dsh-cua` (registered by `dsh-cua`).

- **The section listing behind "Replace everything" misjudged plugin sections in both directions.** It
  decided ownership from a name prefix, which was wrong twice over. `dsh-m` registers its section as
  `tool:dshm`, which looks first-party and was silently counted as such; `dsh-cua`'s
  `computer-use:dsh-cua` does not start with a first-party prefix and would have been counted as a
  plugin. The check is now a whitelist of the section names first-party packages actually register, so
  anything not on it is reported as a plugin's. That errs toward over-reporting, which is the safe
  direction: a user is sent to read the list, rather than having a plugin's silent failure hidden from
  them. On a profile running `dsh-m`, the count now correctly includes `tool:dshm`.

### Changed

- Four new host checks pin the two `rc.2` order constants and their position relative to their
  neighbours; five new client checks pin the whitelist, including that neither `tool:dshm` nor
  `computer-use:dsh-cua` is on it.

### Note

No DSH surface this plugin uses changed shape in `0.2.2-rc.2`: `system-prompt/assemble` keeps its
`(assembly, context, next)` waterfall signature, `systemPrompt.section()` and the `PromptSection` fields
are unchanged, and the `agents` / `sessions` / `webServer` services are as before. The two order
constants were the only drift. `engines.dsh` still reads `>=0.2.2-0 <0.3.0-0`, which already admits
`0.2.2-rc.2`; no dependency range changed.

## [0.2.0] — 2026-11-10

### Added

- **"Replace everything" now lists what it will drop.** The panel already held the real assembled
  section list, so "you are about to lose the first-party prompt" was a warning about something it could
  actually enumerate. It now shows every section that will be discarded, with its character count, folds
  the list after 24 entries, and calls out separately how many of those sections belong to **other
  plugins**. That last number is the one that matters: a plugin's tool schema survives a `complete`
  override, but the prose telling the model when and how to call it does not, so the tool stays installed
  and unused with no error anywhere. It reads as "the model got dumber", never as "I turned a mode on".
- When the conversation has not assembled a prompt yet, the panel says it cannot list the sections
  rather than inventing a count.
- Nine structural checks cover the new computation, including that it excludes the plugin's own
  sections, that it folds past 24 entries, and that a disabled `allowComplete` suppresses the list
  entirely.

### Changed

- The README's "Replace everything" warning now leads with the cross-plugin damage rather than only the
  first-party guidance, documents the new per-section listing, and recommends `allowComplete: false` for
  any profile running plugins that contribute prompt sections. Both languages updated, and the config
  table marks that recommendation.

### Note

`allowComplete` still defaults to `true` in the plugin's own patch. This release adds information and
documentation, not a behaviour change: existing users keep the mode unless they turn it off. The
recommendation is in the README because whether to keep a whole-prompt override is the profile owner's
call, and silently removing a documented mode from under them would be worse than the risk it avoids.

## [0.1.9] — 2026-11-10

### Changed

- The README now says which npm package this is. It described the install as coming "from npm" without
  ever naming the npm page, so a reader could not tell this plugin apart from the unrelated **unscoped**
  `dsh-system-prompt-studio` package — a different author's project that npm search ranks first because
  it has downloads and this one does not. Both the English and Chinese install sections now state the
  scoped name, link the npm page, and warn that the unscoped name is someone else's. A badge at the top
  carries the same link.
- `package.json` keywords now include the terms npm actually indexes (`dsh`, `dsh-plugins`, `deepseek`,
  `dsh-desktop`, `system-prompt-override`, `prompt-override`, `prompt-management`, `persona`). The old
  four terms were accurate but too narrow to reach anyone browsing by topic.
- The repository's GitHub **Homepage** field now points at the npm page instead of back at the repo,
  which is where a visitor deciding whether to install looks first.

### Note

Being findable in npm search is governed by download count, not by metadata: this package is indexed
with `searchScore: 0` and sits at rank 989 of 999 for `keywords:prompt-engineering`, while a package
with 538 downloads and the same score is equally invisible. Nothing in this release changes that; the
keywords above only help when someone searches by term, and the README and Homepage changes make the
scoped name unambiguous for anyone who arrives from GitHub.

## [0.1.8] — 2026-11-10

### Fixed

- The README shipped inside the published 0.1.7 tarball still pinned 0.1.4 in its install examples.
  0.1.7 went out before that documentation fix landed, so the tarball carries the stale text even
  though the repository no longer does. This release republishes the same code with the corrected
  README.

### Added

- A CI step fails when any version pinned in the README install examples (`#v1.2.3`, `@1.2.3`) differs
  from `package.json`. Nothing went red when those drifted, and a reader would copy a command
  installing a version two releases behind the one being described.

## [0.1.7] — 2026-11-10

### Fixed

- **The plugin prevented DSH from starting.** Renaming the package to a scoped name left the client
  bundle registering itself under the old short id. `client-modules` keys its factory table by
  `registration.id`, while the host dispatches the same bundle by package name, so the two ids made it
  register twice and the renderer threw `duplicate factory registration for "dsh-system-prompt-studio"`.
  DSH showed "无法使用" and refused to boot. The id is now the package name.

  This is the third distinct way the rename broke something, and each one only surfaced at real startup:
  the profile `bundles` entry, the `cordis.patch.yml` `name`, and now the client id. A CI step now
  asserts that the manifest name, the patch `name`, and the client `id` are the same string, so the
  next rename fails in CI instead of on someone's machine.

## [0.1.6] — 2026-11-10

### Fixed

- The new "published tarball is installable" CI step failed on both Node versions with nothing but
  `exit code 254`. Cause: it packed into `/tmp/pack`, which does not exist, and redirected
  `npm pack`'s output to `/dev/null`, so the real error was discarded. A check written to prevent
  silent failures failed silently on its first run. It now uses `mktemp -d` and lets `npm pack` print.

## [0.1.5] — 2026-11-10

### Changed

- The package is now published to npm as `@user-mrz/dsh-system-prompt-studio`. The unscoped name
  `dsh-system-prompt-studio` was already taken on npm, so the scoped name keeps the same identity under
  a namespace the author controls.
- `cordis.patch.yml` keeps `id: dsh-system-prompt-studio` but its `name` is now the scoped package. The
  loader imports the row by `name`, so those two must agree; `id` is the anchor existing users override
  by, so renaming it would silently drop their patch entries.
- `description` in `package.json` is now English, since that is what npm renders in search results.

### Fixed

- **The published tarball could not be installed.** `files` omitted `scripts/`, so `prepare` — which
  runs `scripts/verify-entry.mjs` — failed with `MODULE_NOT_FOUND` on every install. The repository
  always had that directory, which is exactly why no test here could see it; only the packed tarball
  exposes the gap. `scripts` is now included, and CI unpacks the real tarball and runs `prepare` inside
  it, so this class of mistake cannot ship again.

## [0.1.4] — 2026-11-10

### Fixed

- The "section list is out of date" warning was decided by comparing millisecond timestamps. A save and
  an assembly can land in the same millisecond — in the test suite they almost always do — and then
  `updatedAt > assembly.at` is false, so a genuinely stale list was reported as current and the panel
  stayed silent. Staleness is now decided by a monotonic write sequence instead. The sequence resumes
  from the highest value in the state file on startup, so a restart cannot make a new write look older
  than a stored one.

### Added

- CI workflow (`.github/workflows/check.yml`) on Node 20 and 22: syntax, both structural test suites,
  the install-time `prepare` script, manifest sanity (`dsh.bundle.patch` exists, every `exports` subpath
  resolves), version/CHANGELOG consistency, and a guard against committed personal data.
- `sectionsSeq` on the status payload, for the staleness comparison.

## [0.1.3] — 2026-11-10

### Fixed

- The section list no longer looks broken when it is merely out of date. Assembly runs on a model
  request, not on save, so the list was always one request behind; the panel now shows the assembly's
  clock time and says explicitly when that assembly predates the current override.
- **Replace everything** mode now labels its section list. The harness replaces the whole section
  array *after* the `system-prompt/assemble` waterfall, so every observer necessarily sees the
  pre-replacement list. The panel explains this instead of leaving the user to conclude the override
  did nothing.

### Added

- `sectionsAt`, `sectionsStale` and `sectionsComplete` on the status payload.

## [0.1.2] — 2026-11-09

### Added

- An entry point in `conversation.hero.options`, so a brand-new conversation can be given a system
  prompt before its first message. The blank conversation renders with `hideChrome`, which means
  `conversation.session.header.actions` never mounts there and the panel was previously unreachable
  until a message had been sent.
- `showOnNewConversation` config key (default `true`) to turn that second entry point off.

### Fixed

- `scopeGlobalHint` claimed the global default applied to *new* conversations. It applies to every
  top-level conversation without an override of its own, including ones that already existed.

## [0.1.1] — 2026-11-09

### Fixed

- Forked conversations inherit the nearest upstream override along `parentSession`, with a *Pin*
  action to freeze the inherited result locally. Previously a fork silently reverted to the default
  prompt, which was the failure mode hardest to notice.
- Unsaved edits are guarded: `Esc`, backdrop clicks and the close button all ask before discarding,
  and `beforeunload` fires only when the panel is actually dirty.
- The module export surface no longer exposes write paths (`install`, `handlePost`, …) to any
  same-process importer; test hooks are gated behind `NODE_ENV=test`.

## [0.1.0] — 2026-11-09

### Added

- Initial release: per-conversation system prompt overrides in three modes (append, shadow-replace a
  named section, replace everything), persisted to `$DSH_HOME/dsh-system-prompt-studio/state.json`.
- Global default scope for top-level conversations.
- Read-only assembly observer listing the real section names, order and size.
- Loopback-only HTTP route for the panel; forged `Host` headers are refused.

[Unreleased]: https://github.com/user-Mrz/dsh-system-prompt-studio/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/user-Mrz/dsh-system-prompt-studio/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/user-Mrz/dsh-system-prompt-studio/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/user-Mrz/dsh-system-prompt-studio/compare/v0.1.9...v0.2.0
[0.1.9]: https://github.com/user-Mrz/dsh-system-prompt-studio/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/user-Mrz/dsh-system-prompt-studio/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/user-Mrz/dsh-system-prompt-studio/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/user-Mrz/dsh-system-prompt-studio/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/user-Mrz/dsh-system-prompt-studio/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/user-Mrz/dsh-system-prompt-studio/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/user-Mrz/dsh-system-prompt-studio/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/user-Mrz/dsh-system-prompt-studio/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/user-Mrz/dsh-system-prompt-studio/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/user-Mrz/dsh-system-prompt-studio/releases/tag/v0.1.0
