#!/usr/bin/env bash
# Vercel "Ignored Build Step". Exit 0 skips the build; any other exit builds.
# Fails open: production, a missing previous SHA, a shallow clone or any git error all build.
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
previous="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$previous" ] || ! git cat-file -e "$previous^{commit}" 2>/dev/null; then
  echo "build: no usable previous deployment commit"
  exit 1
fi
if ! files="$(git diff --name-only "$previous" HEAD 2>/dev/null)" || [ -z "$files" ]; then
  echo "build: could not list changed files"
  exit 1
fi
while IFS= read -r file; do
  case "$file" in
    docs/*|security/*|.github/*|*.md) ;;
    *)
      echo "build: application or test change in $file"
      exit 1
      ;;
  esac
done <<< "$files"
echo "skip: documentation-only change since the last built commit"
exit 0
