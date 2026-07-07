# nvm (lazy-loaded for faster shell startup)
export NVM_DIR="${HOME}/.nvm"
_load_nvm() {
  unset -f nvm node npm npx yarn pnpm pnpx bun bunx
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
}
nvm() { _load_nvm; nvm "$@"; }
node() { _load_nvm; node "$@"; }
npm() { _load_nvm; npm "$@"; }
npx() { _load_nvm; npx "$@"; }
yarn() { _load_nvm; yarn "$@"; }
pnpm() { _load_nvm; pnpm "$@"; }
pnpx() { _load_nvm; pnpx "$@"; }
bun() { _load_nvm; bun "$@"; }
bunx() { _load_nvm; bunx "$@"; }

# Expose the nvm "default" node on PATH for non-interactive shells (hooks, /bin/sh)
# without a full nvm load. Walks the default alias chain (e.g. default -> lts/* ->
# lts/krypton -> v24.18.0) to the resolved version dir.
_d="$(cat "$NVM_DIR/alias/default" 2>/dev/null)"
while [ -f "$NVM_DIR/alias/$_d" ]; do _d="$(cat "$NVM_DIR/alias/$_d")"; done
[ -d "$NVM_DIR/versions/node/$_d/bin" ] && export PATH="$NVM_DIR/versions/node/$_d/bin:$PATH"
unset _d

# Open Plannotator (and other PLANNOTATOR_BROWSER-aware tools) in Orca's built-in browser
export PLANNOTATOR_BROWSER="${HOME}/.local/bin/plannotator-orca-open"