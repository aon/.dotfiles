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