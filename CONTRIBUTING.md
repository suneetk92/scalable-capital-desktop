# Contributing

Start with [`README.md`](README.md) for setup, architecture and the checks for this desktop app. Follow
[`AGENTS.md`](AGENTS.md) for code style, account-safety rules, secrets handling and release constraints.

Run the checks relevant to your change from the README's **Development checks** section. Frontend tests
live beside their modules as `*.test.ts`, script tests live in `scripts/*.test.mjs`, and Rust tests are
inline `mod tests` modules. Do not call Scalable account write tools during tests; use mocked data.

Write commit subjects users can understand. `feat:` and `fix:` subjects are included in release notes;
other maintenance prefixes are omitted there.