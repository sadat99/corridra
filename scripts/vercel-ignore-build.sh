#!/usr/bin/env bash
# Vercel "Ignored Build Step". Exit 0 skips the build; any other exit builds.
# Fails open: production, no usable comparison point or any git error all build.
set -u
if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "build: production deployments are never skipped"
  exit 1
fi
case "${VERCEL_GIT_COMMIT_REF:-}" in
  dependabot/*)
    echo "skip: dependency bot branch preview"
    exit 0
    ;;
esac

# Choose what to compare against, in order: the last built commit of this branch, then main.
# Tree-to-tree diffs need no history, so a depth-one fetch is enough in a shallow clone.
base=""
label=""
previous="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -n "$previous" ]; then
  if git cat-file -e "$previous^{commit}" 2>/dev/null; then
    base="$previous"
    label="the last built commit"
  elif git fetch -q --no-tags --depth=1 origin "$previous" 2>/dev/null; then
    base="FETCH_HEAD"
    label="the last built commit"
  fi
fi
if [ -z "$base" ] && git fetch -q --no-tags --depth=1 origin main 2>/dev/null; then
  base="FETCH_HEAD"
  label="main"
fi
if [ -z "$base" ]; then
  echo "build: no usable comparison commit (previous sha $([ -n "$previous" ] && echo set || echo unset))"
  exit 1
fi
if ! files="$(git diff --name-only "$base" HEAD 2>/dev/null)"; then
  echo "build: could not list changed files"
  exit 1
fi
if [ -z "$files" ]; then
  echo "skip: no file differs from $label"
  exit 0
fi
while IFS= read -r file; do
  case "$file" in
    docs/*|security/*|.github/*|*.md) ;;
    *)
      echo "build: application or test change in $file (compared with $label)"
      exit 1
      ;;
  esac
done <<< "$files"
echo "skip: documentation-only change since $label"
exit 0
