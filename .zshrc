# Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

# Variables
DOTFILES=${HOME}/.dotfiles
typeset -U PATH  # Ensure unique PATH entries

## ZSH options
setopt extendedglob                                             # Extended globbing. Allows using regular expressions with *
setopt nobeep                                                   # No beep
setopt autocd                                                   # if only directory path is entered, cd there.
# Speed up completions
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}'       # Case insensitive tab completion
zstyle ':completion:*' list-colors "${(s.:.)LS_COLORS}"         # Colored completion (different colors for dirs/files/etc)
zstyle ':completion:*' rehash true                              # automatically find new executables in path
zstyle ':completion:*' accept-exact '*(N)'
zstyle ':completion:*' use-cache on
zstyle ':completion:*' cache-path ${HOME}/.zsh_cache
zstyle ':completion:*' menu no                                  # Disable menu completion in favor of fzf plugin
zstyle ':fzf-tab:complete:cd:*' fzf-preview 'ls --color $realpath'  # Preview for fzf-tab
zstyle ':fzf-tab:complete:__zoxide_z:*' fzf-preview 'ls --color $realpath'  # Preview for zoxide

WORDCHARS=${WORDCHARS//\/[&.;]}

# History
HISTFILE=${HOME}/.zsh_history
HISTSIZE=10000
SAVEHIST=$HISTSIZE
HISTDUP=erase                                                   # Erase duplicates in history
setopt inc_append_history                                       # Append history as soon as it is written
setopt no_share_history                                         # Don't share history between sessions
setopt hist_ignore_space                                        # Ignore commands that start with a space
setopt hist_ignore_all_dups
setopt hist_save_no_dups
setopt hist_ignore_dups
setopt hist_find_no_dups

## Keybindings
bindkey -e                                                      # Use emacs key bindings
bindkey '^[[7~' beginning-of-line                               # Home key
bindkey '^[[H' beginning-of-line                                # Home key
if [[ "${terminfo[khome]}" != "" ]]; then
  bindkey "${terminfo[khome]}" beginning-of-line                # [Home] - Go to beginning of line
fi
bindkey '^[[8~' end-of-line                                     # End key
bindkey '^[[F' end-of-line                                      # End key
if [[ "${terminfo[kend]}" != "" ]]; then
  bindkey "${terminfo[kend]}" end-of-line                       # [End] - Go to end of line
fi
bindkey '^[[2~' overwrite-mode                                  # Insert key
bindkey '^[[3~' delete-char                                     # Delete key
bindkey '^[[C'  forward-char                                    # Right key
bindkey '^[[D'  backward-char                                   # Left key
bindkey '^[[5~' history-beginning-search-backward               # Page up key
bindkey '^[[6~' history-beginning-search-forward                # Page down key
bindkey '^L'    clear-screen					                          # Clear screen
bindkey '^[[1;3C' forward-word  					                      # Move one word forward
bindkey '^[[1;3D' backward-word   					                    # Move one word backwards
bindkey '^[[3;3~' kill-word                                     # Delete next word
# Bind up and down arrow keys to history substring search
zmodload zsh/terminfo
bindkey "$terminfo[kcuu1]" history-substring-search-up
bindkey "$terminfo[kcud1]" history-substring-search-down
bindkey '^[[A' history-substring-search-up
bindkey '^[[B' history-substring-search-down

## Alias section
alias cp="cp -i"                                                # Confirm before overwriting something
alias df='df -h'                                                # Human-readable sizes
alias ls="ls -G"                                                # macOS/BSD colored output
alias ll='ls -l'
alias vim="nvim"
alias pip="pip3"
alias python="python3"
alias code="cursor"
alias lg="lazygit"
alias lzd="lazydocker"

## Source utils
[ -f "${HOME}/.zshrc_utils" ] && source "${HOME}/.zshrc_utils"

## Scripts
export PATH="$PATH:${DOTFILES}/scripts"

## Powerlevel10k
source_if_exists ${DOTFILES}/zsh/powerlevel10k/powerlevel10k.zsh-theme
source_if_exists ${HOME}/.p10k.zsh

## Plugins
# Order is carefully chosen to avoid conflicts
fpath=(${DOTFILES}/zsh/zsh-completions/src $fpath)

source ${DOTFILES}/zsh/fzf-tab/fzf-tab.plugin.zsh
source ${DOTFILES}/zsh/zsh-autosuggestions/zsh-autosuggestions.zsh
source ${DOTFILES}/zsh/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh  # Must be loaded last but before zsh-history-substring-search
source ${DOTFILES}/zsh/zsh-history-substring-search/zsh-history-substring-search.zsh

## Applications

# binaries
export PATH="$PATH:${HOME}/.local/bin"

# brew
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
BREW_PREFIX="/opt/homebrew"
FPATH="${BREW_PREFIX}/share/zsh/site-functions:${FPATH}"
export LIBRARY_PATH="${LIBRARY_PATH}:${BREW_PREFIX}/lib"

# claude code
claude() {
  GITHUB_PERSONAL_ACCESS_TOKEN="$(get_private_config GITHUB_PERSONAL_ACCESS_TOKEN)" \
  /Users/agustin/.local/bin/claude "$@"
}

# docker (regenerate completions when docker version changes)
if type docker &> /dev/null; then
  local docker_comp="${HOME}/.docker/completions/_docker"
  local docker_ver="${docker_comp}.version"
  if [[ ! -f "$docker_comp" ]] || [[ "$(docker --version 2>/dev/null)" != "$(cat "$docker_ver" 2>/dev/null)" ]]; then
    mkdir -p ${HOME}/.docker/completions
    docker completion zsh > "$docker_comp"
    docker --version > "$docker_ver"
  fi
  fpath=(${HOME}/.docker/completions $fpath)
fi

# Optimized compinit - only regenerate once per day
autoload -Uz compinit
if [[ -n ${HOME}/.zcompdump(#qN.mh+24) ]]; then
  compinit
else
  compinit -C
fi

# editor
export EDITOR=nvim

# fzf
eval "$(fzf --zsh)"

# foundry
export PATH="$PATH:${HOME}/.foundry/bin"

# golang
if type go &> /dev/null; then
    export GOPATH=$HOME/.go
    export PATH=$PATH:$GOPATH/bin
fi

# iterm
source_if_exists "${HOME}/.iterm2_shell_integration.zsh"

# lazydocker
if type lazydocker &> /dev/null; then
    alias lzd="lazydocker"
fi

# libpq
if [ -d "/opt/homebrew/opt/libpq/bin" ]; then
    export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
fi

# macos specific
ulimit -n 10240

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

# Auto-switch node version on directory change (and on shell startup)
autoload -U add-zsh-hook
_auto_load_nvmrc() {
  if [[ -f .nvmrc ]] && type nvm &>/dev/null; then
    nvm use --silent
  fi
}
add-zsh-hook chpwd _auto_load_nvmrc
_auto_load_nvmrc  # Also run on shell startup for when terminal opens directly in a folder with .nvmrc

# rust
source_if_exists ${HOME}/.cargo/env

# zoxide
if [[ "$CLAUDECODE" != "1" ]]; then
  eval "$(zoxide init --cmd cd zsh)"
fi

## Work related
# claude code
claude-msl() {
  CLAUDE_CONFIG_DIR=${HOME}/Developer/msl/.claude \
  ANTHROPIC_BASE_URL=https://train.msldev.io \
  ANTHROPIC_AUTH_TOKEN="$(get_private_config MSL_ANTHROPIC_AUTH_TOKEN)" \
  claude  "$@"
}
