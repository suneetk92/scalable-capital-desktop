#!/usr/bin/env bash
# Publishes the signed release files as a GitHub Release with the gh CLI: the installers, their .sig
# files, SHA256SUMS.txt and (for a stable tag) the updater manifest latest.json, whose installer URLs
# point at the release.
#
#   scripts/publish-github-release.sh [--dry-run] vX.Y.Z <artifacts-dir>
#
# <artifacts-dir> holds what the build made: the installers, the `.sig` files and SHA256SUMS.txt.
# RELEASES_REPO (owner/name) is the target repository; it defaults to GITHUB_REPOSITORY in GitHub
# Actions, and otherwise to the GitHub repository of the `origin` remote. gh needs a login or GH_TOKEN
# with write access to it (contents: write).
#
# The release is created as a draft with the installers, then latest.json is added and the draft is
# published, so an app never sees a manifest whose files are not there yet. A vX.Y.Z-rc.N tag is a
# pre-release with no latest.json, which you download by hand: /releases/latest/download never points at
# a pre-release. Run again for the same tag to replace the files and the notes of an existing release.
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
node scripts/make-latest-json.mjs "$artifacts" "$tag" "$url/releases/latest/download" "$work/site" --partial \
  --download-base="$url/releases/download" --notes-url="$url/releases/tag/$tag" --notes-file="$notes"

files=()
for file in "$artifacts"/*; do
  [ -f "$file" ] && files+=("$file")
done
[ "${#files[@]}" -gt 0 ] || die "$artifacts has no files"

flags=(--latest)
case "$tag" in *-*) flags=(--prerelease) ;; esac
manifest=()
case "$tag" in *-*) ;; *) manifest=("$work/site/latest.json") ;; esac

if $dry_run; then
  echo "Dry run: would publish $tag to $repo with ${flags[*]} and these files:"
  printf '  %s\n' "${files[@]##*/}" "${manifest[@]##*/}"
  echo "Release notes:"
  sed 's/^/  | /' "$notes"
  if [ "${#manifest[@]}" -gt 0 ]; then
    echo "latest.json:"
    sed 's/^/  | /' "${manifest[0]}"
  fi
  exit 0
fi

if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  gh release upload "$tag" "${files[@]}" "${manifest[@]}" --repo "$repo" --clobber
  gh release edit "$tag" --repo "$repo" --notes-file "$notes"
else
  gh release create "$tag" "${files[@]}" --repo "$repo" --draft --title "Scalable Capital Desktop $tag" --notes-file "$notes"
  [ "${#manifest[@]}" -eq 0 ] || gh release upload "$tag" "${manifest[@]}" --repo "$repo" --clobber
  gh release edit "$tag" --repo "$repo" --draft=false "${flags[@]}"
fi

if [ "${#manifest[@]}" -gt 0 ]; then
  served=$(curl -fsSL --retry 3 "$url/releases/latest/download/latest.json" \
    | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).version") \
    || die "published, but $url/releases/latest/download/latest.json is not served"
  [ "$served" = "${tag#v}" ] || die "latest.json serves $served, not ${tag#v}"
fi
echo "Published $tag to $url/releases/tag/$tag"
