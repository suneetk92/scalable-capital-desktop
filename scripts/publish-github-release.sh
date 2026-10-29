#!/usr/bin/env bash
# Publishes the signed release files as a GitHub Release with the gh CLI: the installers, their .sig
# files, SHA256SUMS.txt and (for a stable tag) the updater manifest latest.json, whose installer URLs
# point at the release.
#
#   scripts/publish-github-release.sh [--dry-run] vX.Y.Z <artifacts-dir>
#
# <artifacts-dir> holds what the build made for every platform, in one flat folder: the installers, the
# `.sig` files and SHA256SUMS.txt. latest.json needs the updatable installer and its `.sig` of every
# platform (Windows, macOS Apple Silicon and Intel, Linux x64 and arm64 AppImages); a missing one stops
# the release before anything is uploaded.
# RELEASES_REPO (owner/name) is the target repository; it defaults to GITHUB_REPOSITORY in GitHub
# Actions, and otherwise to the GitHub repository of the `origin` remote. gh needs a login or GH_TOKEN
# with write access to it (contents: write).
#
# The release is created as a draft with the installers, then latest.json is added and the draft is
# published, so an app never sees a manifest whose files are not there yet. A stable tag becomes the
# latest release unless a newer release is out already. Stable is the only update channel: a
# vX.Y.Z-rc.N tag is a pre-release with no latest.json, which you download by hand
# (/releases/latest/download never points at a pre-release, and the app is never offered one). Run
# again for the same tag to finish a draft that an earlier run left behind, or to replace the files
# and the notes of a published release (its latest.json is removed first and uploaded again last).
# --dry-run prepares the files and uploads nothing.
#
# The release notes are made from the commits since the previous release (scripts/release-notes.mjs),
# so this needs the full git history and the tags.
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }

# owner/name of a GitHub remote URL (https or ssh), or nothing.
github_repo() { sed -nE 's#^(https://github\.com/|git@github\.com:|ssh://git@github\.com/)([^/]+/[^/]+)$#\2#p' | sed 's/\.git$//'; }

repo=${RELEASES_REPO:-${GITHUB_REPOSITORY:-}}
[ -n "$repo" ] || repo=$(git remote get-url origin 2>/dev/null | github_repo || true)
[ -n "$repo" ] || die "set RELEASES_REPO=owner/name (no GitHub origin remote found)"
echo "$repo" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' || die "RELEASES_REPO=$repo is not owner/name"

dry_run=false
args=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    *) args+=("$arg") ;;
  esac
done
[ "${#args[@]}" -eq 2 ] || die "usage: scripts/publish-github-release.sh [--dry-run] vX.Y.Z <artifacts-dir>"
tag=${args[0]}
artifacts=${args[1]}

echo "$tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' || die "$tag is not a version like v1.2.3"
[ -d "$artifacts" ] || die "$artifacts is not a directory"
command -v node >/dev/null || die "node is needed"
$dry_run || command -v gh >/dev/null || die "the gh CLI is needed"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

notes="$work/notes.md"
node scripts/release-notes.mjs "$tag" > "$notes" || die "could not make the release notes from the git history"

url="https://github.com/$repo"
node scripts/make-latest-json.mjs "$artifacts" "$tag" "$url/releases/latest/download" "$work/site" \
  --download-base="$url/releases/download" --notes-url="$url/releases/tag/$tag" --notes-file="$notes"

files=()
for file in "$artifacts"/*; do
  [ -f "$file" ] && files+=("$file")
done
[ "${#files[@]}" -gt 0 ] || die "$artifacts has no files"

manifest=()
case "$tag" in *-*) ;; *) manifest=("$work/site/latest.json") ;; esac

if $dry_run; then
  echo "Dry run: would publish $tag to $repo and these files:"
  printf '  %s\n' "${files[@]##*/}" "${manifest[@]##*/}"
  echo "Release notes:"
  sed 's/^/  | /' "$notes"
  if [ "${#manifest[@]}" -gt 0 ]; then
    echo "latest.json:"
    sed 's/^/  | /' "${manifest[0]}"
  fi
  exit 0
fi

# The tag of the repository's latest release, or nothing before the first one.
latest_tag() { gh api "repos/$repo/releases/latest" --jq .tag_name 2>/dev/null || true; }

# A stable tag becomes the latest release unless a newer one is out already, so a fix for an older
# version does not take latest.json away from the newest release.
flags=(--prerelease)
if [ "${#manifest[@]}" -gt 0 ]; then
  current=$(latest_tag)
  if [ -z "$current" ] || [ "$(printf '%s\n' "$current" "$tag" | sort -V | tail -n 1)" = "$tag" ]; then
    flags=(--latest)
  else
    flags=(--latest=false)
  fi
fi

# missing, draft (a run that stopped before publishing) or published.
state=$(gh release view "$tag" --repo "$repo" --json isDraft --jq 'if .isDraft then "draft" else "published" end' 2>/dev/null || echo missing)
case "$state" in
  missing)
    gh release create "$tag" "${files[@]}" --repo "$repo" --draft --title "$tag" --notes-file "$notes"
    ;;
  draft)
    gh release upload "$tag" "${files[@]}" --repo "$repo" --clobber
    gh release edit "$tag" --repo "$repo" --notes-file "$notes"
    ;;
  published)
    # The old manifest goes first, so no app follows it to an installer that is being replaced.
    if [ "${#manifest[@]}" -gt 0 ]; then
      gh release delete-asset "$tag" latest.json --repo "$repo" --yes 2>/dev/null || true
    fi
    gh release upload "$tag" "${files[@]}" --repo "$repo" --clobber
    gh release edit "$tag" --repo "$repo" --notes-file "$notes"
    ;;
esac
# The manifest is uploaded last, once every file it points at is there.
[ "${#manifest[@]}" -eq 0 ] || gh release upload "$tag" "${manifest[@]}" --repo "$repo" --clobber
[ "$state" = published ] || gh release edit "$tag" --repo "$repo" --draft=false "${flags[@]}"

if [ "${#manifest[@]}" -gt 0 ]; then
  now=$(latest_tag)
  if [ "$now" = "$tag" ]; then
    served=$(curl -fsSL --retry 3 "$url/releases/latest/download/latest.json" \
      | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).version") \
      || die "published, but $url/releases/latest/download/latest.json is not served"
    [ "$served" = "${tag#v}" ] || die "latest.json serves $served, not ${tag#v}"
  else
    echo "$tag is not the latest release, so installed apps keep reading the manifest of ${now:-no release}."
  fi
fi
echo "Published $tag to $url/releases/tag/$tag"
