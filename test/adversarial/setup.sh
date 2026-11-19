#!/usr/bin/env bash
set -eu
ADV_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ADV_VENV="${TC_ADV_VENV:-$ADV_DIR/.venv}"
adv_python_supported() {
  "$1" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1
}
ADV_PYTHON=''
if [ -n "${PYTHON:-}" ]; then
  if ! adv_python_supported "$PYTHON"; then
    printf 'PYTHON=%s must be an executable Python >=3.10 (nodriver requires PEP 604 types).\n' "$PYTHON" >&2
    exit 1
  fi
  ADV_PYTHON="$PYTHON"
else
  for candidate in /opt/homebrew/bin/python3.13 /opt/homebrew/bin/python3.11 python3.13 python3.11 python3; do
    if adv_python_supported "$candidate"; then ADV_PYTHON="$candidate"; break; fi
  done
  if [ -z "$ADV_PYTHON" ]; then
    printf 'Python >=3.10 required. Install Python 3.13 or 3.11, or set PYTHON to its executable.\n' >&2
    exit 1
  fi
fi
if [ -e "$ADV_VENV/pyvenv.cfg" ] && ! adv_python_supported "$ADV_VENV/bin/python"; then
  printf 'Existing venv %s uses Python <3.10 or is broken. Rebuild it with %s, or set TC_ADV_VENV to a new directory.\n' "$ADV_VENV" "$ADV_PYTHON" >&2
  exit 1
fi
printf 'Creating/updating venv with %s\n' "$ADV_PYTHON"
"$ADV_PYTHON" -m venv "$ADV_VENV"
if ! adv_python_supported "$ADV_VENV/bin/python"; then
  printf 'Venv Python must be >=3.10: %s/bin/python\n' "$ADV_VENV" >&2
  exit 1
fi
"$ADV_VENV/bin/python" -m pip install 'pip==25.1.1' 'setuptools==80.9.0' 'wheel==0.45.1'
# Install independently so an unsupported tool does not prevent the others.
ADV_FAILED=0
while IFS= read -r requirement; do
  case "$requirement" in ''|'#'*) continue ;; esac
  if ! "$ADV_VENV/bin/python" -m pip install "$requirement"; then ADV_FAILED=1; fi
done < "$ADV_DIR/requirements.txt"
if ! "$ADV_VENV/bin/python" -m camoufox fetch; then ADV_FAILED=1; fi
cd "$ADV_DIR"
if [ -f package-lock.json ]; then
  if ! npm ci; then ADV_FAILED=1; fi
else
  if ! npm install; then ADV_FAILED=1; fi
fi
if [ -x node_modules/.bin/patchright ]; then
  if ! node_modules/.bin/patchright install chromium; then ADV_FAILED=1; fi
else
  ADV_FAILED=1
fi
mkdir -p ../results/adversarial
"$ADV_VENV/bin/python" -m pip freeze > ../results/adversarial/pip-freeze.txt
printf '\nSetup finished (dependency errors: %s). Run: bash %s/run-all.sh\n' "$ADV_FAILED" "$ADV_DIR"
exit "$ADV_FAILED"
