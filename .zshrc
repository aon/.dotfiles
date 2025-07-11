# Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

# Variables
DOTFILES=${HOME}/.dotfiles

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
setopt no_share_history                                         # Share history between sessions
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
alias free='free -m'                                            # Show sizes in MB
alias ls="ls --color"
alias ll='ls -l'
alias vim="nvim"
alias pip="pip3"
alias python="python3"
alias git-list-gone="git fetch -p && for branch in \$(git for-each-ref --format '%(refname) %(upstream:track)' refs/heads | awk '\$2 == \"[gone]\" {sub(\"refs/heads/\", \"\", \$1); print \$1}'); do echo \$branch; done"
alias git-delete-gone="git-list-gone | xargs git branch -D"
alias code="cursor"
alias rr='while [ $? -ne 0 ]; do sleep 1; eval $(history -p !!); done'

## Source utils
[ -f "${HOME}/.zshrc_utils" ] && source "${HOME}/.zshrc_utils"

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
BREW_PREFIX=$(brew --prefix)
if type brew &>/dev/null; then
  FPATH="${BREW_PREFIX}/share/zsh/site-functions:${FPATH}"
  export LIBRARY_PATH="${LIBRARY_PATH}:${BREW_PREFIX}/lib"
fi

# docker
if type docker &> /dev/null; then
  if [ ! -f ${HOME}/.docker/completions/_docker ]; then
    mkdir -p ${HOME}/.docker/completions
    docker completion zsh > ${HOME}/.docker/completions/_docker
  fi
  fpath=(${HOME}/.docker/completions $fpath)
fi

autoload -Uz compinit; compinit # Must be done after all fpath modifications

# fzf
eval "$(fzf --zsh)"

# foundry
export PATH="$PATH:${HOME}/.foundry/bin"

# golang
if type go &> /dev/null; then
    export GOPATH=$HOME/.go
    export PATH=$PATH:$(go env GOPATH)/bin
fi

# iterm
source_if_exists "${HOME}/.iterm2_shell_integration.zsh"

# lazydocker
if type lazydocker &> /dev/null; then
    alias lzd="lazydocker"
fi

# macos specific
ulimit -n 10240

# nvm
export NVM_DIR="${HOME}/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

autoload -U add-zsh-hook
add-zsh-hook chpwd load-nvmrc
load-nvmrc

# rust
source_if_exists ${HOME}/.cargo/env

# zoxide
if [ -z "$DISABLE_ZOXIDE" ]; then
  eval "$(zoxide init --cmd cd zsh)"
fi

## Work related

# zksync-era
export ROCKSDB_LIB_DIR="${BREW_PREFIX}/Cellar/rocksdb/9.7.4/lib"
export SNAPPY_LIB_DIR="${BREW_PREFIX}/Cellar/snappy/1.2.1/lib"

# zkstack completion
source_if_exists "${HOME}/.zsh/completion/_zkstack.zsh"

# pyenv
export PYENV_ROOT="$HOME/.pyenv"
[[ -d $PYENV_ROOT/bin ]] && export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init - zsh)"

# taskmaster
alias tm="task-master"

# claude code
MSL_ANTHROPIC_AUTH_TOKEN_VAR=$(get_private_config MSL_ANTHROPIC_AUTH_TOKEN)
alias claude-msl="CLAUDE_CONFIG_DIR=~/Developer/msl API_TIMEOUT_MS=180000 DISABLE_NON_ESSENTIAL_MODEL_CALLS=1 ANTHROPIC_AUTH_TOKEN=\$MSL_ANTHROPIC_AUTH_TOKEN_VAR ANTHROPIC_BASE_URL=https://claude-1.msldev.io claude"
