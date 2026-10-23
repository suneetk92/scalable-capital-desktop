# Trailing stops

A public extension that is bundled in every build of Scalable Capital Desktop (listed in
`bundled-extensions.json` at the repository root). Scalable's MCP has no trailing stop, so the app follows
the price itself.

- `extension.json`: id, name and version of this extension. The version is separate from the app version;
  change it with `node scripts/set-extension-version.mjs trailing-stops X.Y.Z`.
- `web/index.ts`: the extension for `src/extensions.ts`: the Trailing stops page, its settings section
  (check frequency, stored under `scalable-capital-desktop.trailing-stops`) and the "Set trailing stop loss"
  button of the order dialog. `web/src/` has the page, the dialog, the hook and the pure logic with tests.
- `src-tauri/`: the saved file, quotes, the sale, the watcher and the commands. `mod.rs` exports
  `handler`, `handles`, `setup` and `busy`, which `src-tauri/build.rs` combines for `lib.rs`. A sale always goes
  through the Trading gate in `src-tauri/src/mcp/trading.rs`; nothing here can bypass it.
