# Agent instructions

Scalable Capital Desktop is a Tauri 2 desktop app (Rust backend, React 19 + TypeScript + Tailwind CSS 4
frontend) that is a client of Scalable Capital's MCP server. Read `README.md` first for the features,
the sign-in flow and the layout of the code.

## Windows build (only on request)

Do not rebuild the Windows app after every change. Rebuild and refresh the exes in `release/` only when
the user asks for it:

```bash
CI=true npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
T=src-tauri/target/x86_64-pc-windows-msvc/release
cp $T/scalable-capital-desktop.exe release/scalable-capital-desktop-portable.exe
cp $T/bundle/nsis/scalable-capital-desktop_1.0.0_x64-setup.exe release/
```

The `release` profile uses thin LTO and 16 codegen units, so the last step runs in parallel (the exes are
slightly larger and slower than with fat LTO). The library is built as `rlib` only, because the app is
desktop-only. On Linux, `src-tauri/.cargo/config.toml` links with `clang` and `lld`; install both locally.
Setting `RUSTC_WRAPPER=sccache` also helps after `cargo clean` or when you switch targets.

If the app version changes, the installer file name changes too: update the command, and the three
version fields (`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`) together with
`node scripts/set-version.mjs X.Y.Z`. A release tag sets the version for its own build, so a tag needs no
version commit. `release/` is local build output and is ignored by git.

There is no changelog file: the release notes are made at tag time from the commit subjects since the
previous release (`scripts/release-notes.mjs`) and become the GitHub release notes and the update
notice. Write commit subjects a user can read; `feat:` and `fix:` prefixes group them as New and Fixed,
and `chore:`, `ci:`, `build:`, `test:`, `docs:`, `style:` and `refactor:` commits are left out.

## Checks to run before finishing

```bash
npm run typecheck                                                       # tsc --noEmit
npm test                                                                # Vitest
(cd src-tauri && cargo test --offline)                                  # use --locked in CI
(cd src-tauri && cargo fmt --check && cargo clippy --offline --all-targets -- -D warnings)
(cd src-tauri && rustfmt --check --edition 2021 --config-path rustfmt.toml ../extensions/*/src-tauri/*.rs)
```

CI (`.github/workflows/ci.yml`) runs the same checks plus `vp build` and installer builds for Windows,
macOS and Linux. Run only the checks that match what you changed, but run all of them if you touched
shared code.

## Safety rules

- **Never call a write tool against the real Scalable account** (anything that is not `get_*`,
  `list_*`, `search_*`, `preview_*` or `ping`), and never `submit_*` or `cancel_*`. Use mocked data
  (a mocked Tauri `invoke` in a headless browser) for anything that changes data.
- **Never put tokens or secrets in the repository**, in logs, in docs or in test fixtures. The access
  token is short-lived but still gives account access. `.junie/mcp/mcp.json` is local and ignored.
- The Trading gate lives in Rust (`src-tauri/src/mcp/trading.rs`; the savings-plan commands in `savings.rs`
  use it too). Rust never persists it and starts every launch read-only; the only saved choice is the
  **Start with** setting (Read-only by default), which the UI sends at launch, and Full starts as Restricted
  while the exchange is closed. Signing out, by the user or by Rust, switches it back to read-only. Do not
  weaken it, and do not add a command that reaches a write tool without going through it.
- **The updater private key never enters the repository**, logs, docs or test fixtures. It lives only in
  the secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` of the GitHub `release`
  environment, which only the release jobs use. Local builds need no signing key; CI enables updater
  artifacts through `src-tauri/tauri.updater.conf.json`. The public key in `src-tauri/tauri.conf.json` is
  safe to commit. Test signing only with a throwaway key created in the scratch directory; never print or
  commit its private half.
- Releases are built by GitHub Actions and published to this repository's Releases. The updater
  endpoint in `src-tauri/tauri.conf.json` must remain the GitHub Releases `latest.json` URL. Do not add
  fallback update hosts or storage credentials to the repository.
- Updates go through Rust only (`src-tauri/src/updates.rs`, like `notify.rs`): do not give the webview
  the updater or process plugin.
- Keep the Tauri permissions minimal (`src-tauri/capabilities/default.json`) and the CSP in
  `src-tauri/tauri.conf.json` strict. Do not add remote assets, remote hosts or inline scripts.

## Scope

Scalable Capital Desktop is a desktop-only app. Releases include Windows, macOS and Linux builds, but only
Windows is tested; the macOS and Linux builds are released untested. Do not add a browser, web-server, hosted,
iOS or Android mode, and do not move token storage or the Trading gate out of the Rust process.

## Code conventions

- **Styling is Tailwind utilities only.** No new hand-written CSS classes. Colours come from the semantic
  tokens in `src/index.css` (`bg-surface`, `text-ink-muted`, `border-line`, ...), not from fixed hex
  values (a few overlays and gradients are the only exceptions), so both themes work. Use `rem` and `em`, not `px`, for type, so the font-size setting scales
  everything. Reuse the building blocks in `src/ui.tsx` and `src/controls.tsx` before adding new ones.
- **Text:** sentence case for labels and headings ("Open groups", "Add to watchlist"). Capitals come from
  Tailwind `uppercase` on the shared classes, not from the source text. The product name is "Scalable
  Capital Desktop". Write "Read-only" with a hyphen. Shortcuts read "Ctrl+K", "Alt+Up".
- **Structure:** `src/App.tsx` stays a thin shell. Put pure logic in plain `.ts` files with Vitest tests
  (`screener.ts`, `tools.ts`, `groups.ts`, `settings.ts`, `session.ts`), page code in `src/pages/`, and
  data hooks in `src/hooks/`. Rust code is split by responsibility under `src-tauri/src/mcp/`.
- **Exports:** export only what another file uses (`noUnusedLocals` is on). Remove dead code instead of
  leaving it.
- **Extensions** plug in only through the typed slots in `src/extensions.ts` and the `virtual:app-extension`
  module, which resolves to the empty `src/extensionStub.ts`. Keep the slots generic, and do not import
  anything from outside the repository.
- **Table columns** come from Scalable data only. Keep shared column formatting generic.
- **Tool arguments use the exact property names of each tool's `inputSchema`** (Scalable publishes them
  through `tools/list`); there is no alias table. `tests/fixtures/mcp-tool-list.json` is a saved
  `tools/list` response; the TypeScript and Rust tests check the built arguments against its input
  schemas, and the app itself does not read it. To refresh it, save a new `tools/list` response there
  unchanged. Scalable publishes output schemas too (the Schema window shows them) but the app keeps no
  copy, so read responses defensively.
- Local storage keys use the `scalable-capital-desktop.` prefix.
- Match the style of the surrounding code, and add comments only where the code does the same.

## Icons

`src-tauri/icons/app-icon.svg` is the only icon master. Regenerate the rest with
`npx tauri icon src-tauri/icons/app-icon.svg` and delete the `android/` and `ios/` folders it creates. The
webview has no favicon (a desktop window never shows one). Do not reintroduce default Tauri, Vite or React artwork.

## Documentation

Keep `README.md` accurate when behaviour, commands, workflows or the file layout change. Avoid
hard-coded counts (tests, tools) that go stale.
