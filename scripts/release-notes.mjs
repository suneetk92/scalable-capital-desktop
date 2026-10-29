// Writes the release notes of a tag from the commit subjects since the previous release, so nothing has
// to be written or committed before tagging.
//
//   node scripts/release-notes.mjs <tag>
//
// The range is <previous tag>..<tag>. A stable tag (v1.2.3) starts at the previous stable tag, so a
// release candidate's changes are included; a pre-release tag (v1.2.3-rc.1) starts at the previous tag of
// any kind. A tag that does not exist yet means HEAD. It needs the full history and the tags
// (`git fetch --tags --unshallow`, or `fetch-depth: 0` in CI).
//
// Commits are grouped by their Conventional Commits prefix: `feat:` is New, `fix:` is Fixed, anything
// without a prefix is Changed. `chore`, `ci`, `build`, `test`, `docs`, `style` and `refactor` commits, merges
// and release commits are left out. A breaking change (`!` after the type, as in `feat!:`, or a
// `BREAKING CHANGE:` footer) is always listed, under Changed when its type is left out otherwise. A revert
// (`Revert "feat: ..."`) is listed under Changed when the reverted commit would be listed; a commit that
// is reverted within the same release drops out together with its revert.
import { execFileSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SKIPPED = new Set(["chore", "ci", "build", "test", "docs", "style", "refactor"]);
const SECTIONS = [
  ["New", ["feat"]],
  ["Fixed", ["fix", "perf"]],
  ["Changed", ["other"]],
];
const MAX_PER_SECTION = 25;
const EMPTY = "A maintenance release with no changes you will notice.";

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

const REVERT = /^Revert "(.+)"$/;

/** Where a commit subject goes and how it reads, or null when it is left out. */
function entry(subject, body) {
  if (!subject || /^(Merge|Revert|Release) /i.test(subject) || /^v\d+\.\d+\.\d+/.test(subject)) return null;
  const match = /^(\w+)(\([^)]*\))?(!)?:\s*(.+)$/.exec(subject);
  const type = match?.[1].toLowerCase();
  const breaking = Boolean(match?.[3]) || /^BREAKING[ -]CHANGE:/m.test(body);
  if (type && SKIPPED.has(type) && !breaking) return null;
  const kind = ["feat", "fix", "perf"].includes(type) ? type : "other";
  // An unknown prefix stays part of the text; a known one is dropped.
  const text = kind === "other" && !SKIPPED.has(type) ? subject : match[4];
  return { kind, text: capitalise(text.replace(/\.$/, "").trim()), breaking };
}

/**
 * @param {(string | { subject: string, body?: string })[]} commits commit subjects (or subjects with
 *   their message body), newest first
 * @returns {string} markdown
 */
export function buildNotes(commits) {
  const list = commits.map((commit) => (typeof commit === "string" ? { subject: commit.trim(), body: "" } : { subject: commit.subject.trim(), body: commit.body ?? "" }));
  const reverted = new Set(list.map(({ subject }) => REVERT.exec(subject)?.[1]).filter(Boolean));
  const groups = { feat: [], fix: [], perf: [], other: [] };
  const seen = new Set();
  const add = (kind, line, key) => {
    if (seen.has(key)) return;
    seen.add(key);
    groups[kind].push(line);
  };
  for (const { subject, body } of list) {
    const revert = REVERT.exec(subject);
    if (revert) {
      // A revert of a commit from this same release cancels it out; otherwise it undoes something users had.
      const inner = list.some((other) => other.subject === revert[1]) ? null : entry(revert[1], "");
      if (inner) add("other", `- Reverted: ${inner.text}`, `reverted: ${inner.text.toLowerCase()}`);
      continue;
    }
    if (reverted.has(subject)) continue;
    const item = entry(subject, body);
    if (item) add(item.kind, `- ${item.breaking ? "**Breaking:** " : ""}${item.text}`, item.text.toLowerCase());
  }
  const blocks = [];
  for (const [title, kinds] of SECTIONS) {
    const items = kinds.flatMap((kind) => groups[kind]);
    if (items.length === 0) continue;
    const shown = items.slice(0, MAX_PER_SECTION);
    if (items.length > shown.length) shown.push(`- And ${items.length - shown.length} more.`);
    blocks.push(`### ${title}\n\n${shown.join("\n")}`);
  }
  return blocks.length ? blocks.join("\n\n") : EMPTY;
}

/** The commits in the release range of a tag, newest first, with their subject and message body. `cwd` is the repository. */
export function commitsFor(tag, cwd = process.cwd()) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  let end = "HEAD";
  try {
    git("rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`);
    end = tag;
  } catch {
    // The tag is not made yet: describe what HEAD has since the last release.
  }
  const from = end === "HEAD" ? "HEAD" : `${tag}^`;
  const describe = ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*"];
  if (!tag.includes("-")) describe.push("--exclude", "*-*");
  let previous = "";
  try {
    previous = git(...describe, from);
  } catch {
    // No earlier release: use the whole history.
  }
  // Each commit ends with a record separator; the subject and the body are split by a unit separator.
  const log = git("log", "--no-merges", "--format=%s%x1f%b%x1e", previous ? `${previous}..${end}` : end);
  return log
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [subject, body = ""] = record.split("\x1f");
      return { subject: subject.trim(), body: body.trim() };
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [tag] = process.argv.slice(2);
  if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag ?? "")) {
    console.error("Usage: node scripts/release-notes.mjs <tag>   (a version like v1.2.3)");
    process.exit(2);
  }
  try {
    console.log(buildNotes(commitsFor(tag)));
  } catch (error) {
    console.error(`error: could not read the git history: ${error.message}`);
    process.exit(1);
  }
}
