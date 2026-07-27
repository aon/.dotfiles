# mise shims — real executables on disk, so node/pnpm resolve in non-interactive
# contexts (hooks, /bin/sh, GUI apps) with no shell integration needed. The path is
# static; version resolution happens inside the shim at exec time. Interactive zsh
# additionally runs `mise activate` in .zshrc, which prepends real (non-shim) paths.
export PATH="${HOME}/.local/share/mise/shims:$PATH"

# Open Plannotator (and other PLANNOTATOR_BROWSER-aware tools) in Orca's built-in browser
export PLANNOTATOR_BROWSER="${HOME}/.local/bin/plannotator-orca-open"