#!/usr/bin/env bash
# CI helper (KI-02, KI-41): make `playwright install --with-deps` survive a runner whose resolver
# cannot reach the Ubuntu package mirrors, and print the evidence when it happens.
#
# Never fails the step: a diagnostic that fails the job would hide the real result. If the mirrors
# still do not resolve after the fallback, the browser install step fails on its own, as before.
set -u

hosts=(azure.archive.ubuntu.com archive.ubuntu.com security.ubuntu.com)

resolves() {
  getent hosts "$1" > /dev/null 2>&1
}

report() {
  local ok=0 missing=()
  for h in "${hosts[@]}"; do
    if resolves "$h"; then ok=$((ok + 1)); else missing+=("$h"); fi
  done
  echo "apt-network: $1: $ok of ${#hosts[@]} mirror hosts resolve${missing[*]:+ (not resolving: ${missing[*]})}"
  [ "$ok" -eq "${#hosts[@]}" ]
}

# Short timeouts inside apt, so a stalled connection fails there instead of holding the step.
printf 'Acquire::http::Timeout "15";\nAcquire::https::Timeout "15";\nAcquire::Retries "3";\n' |
  sudo tee /etc/apt/apt.conf.d/99-ci-resilience > /dev/null

if report "before"; then
  exit 0
fi

echo "apt-network: resolver state"
grep -vE '^\s*(#|$)' /etc/resolv.conf 2> /dev/null | sed 's/^/  resolv.conf: /'
(resolvectl status 2> /dev/null | head -20 | sed 's/^/  resolvectl: /') || true

# Fallback: ask public resolvers for the mirror names (systemd-resolved, then resolv.conf).
if command -v resolvectl > /dev/null 2>&1; then
  iface=$(ip route show default 2> /dev/null | awk '/default/ {print $5; exit}')
  if [ -n "${iface:-}" ]; then
    sudo resolvectl dns "$iface" 1.1.1.1 8.8.8.8 9.9.9.9 || true
    sudo resolvectl flush-caches || true
  fi
fi
if ! report "after resolvectl fallback"; then
  if [ -w /etc/resolv.conf ] || sudo test -w /etc/resolv.conf; then
    printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\nnameserver 9.9.9.9\n' | sudo tee -a /etc/resolv.conf > /dev/null
  fi
  report "after resolv.conf fallback" ||
    echo "::warning title=Ubuntu mirrors do not resolve::The runner resolver and the public fallbacks all failed for the Ubuntu package mirrors (KI-41). The browser install will fail; re-run the failed jobs once."
fi
exit 0
