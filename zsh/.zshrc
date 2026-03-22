# ══════════════════════════════════════════════
#  ZSH Config — Material You Rice
# ══════════════════════════════════════════════

# ── Autostart niri (tty1 or VMware pts/0) ──
if [[ -z "$WAYLAND_DISPLAY" ]] && [[ -z "$DISPLAY" ]]; then
    if [[ "$(tty)" == /dev/tty1 ]] || [[ "$(tty)" == /dev/pts/0 && "$(systemd-detect-virt 2>/dev/null)" != "none" ]]; then
        exec niri --session
    fi
fi

# Disable grml prompt (starship takes over)
prompt off

# ── History ──────────────────────────────────
HISTFILE=~/.zsh_history
HISTSIZE=10000
SAVEHIST=10000
setopt appendhistory
setopt INC_APPEND_HISTORY
setopt SHARE_HISTORY
setopt HIST_IGNORE_DUPS
setopt HIST_IGNORE_SPACE

# ── Aliases ──────────────────────────────────
alias ls='ls --color=auto'
alias ll='ls -lah'
alias la='ls -A'
alias grep='grep --color=auto'
alias update='sudo pacman -Syu'
alias c='clear'
alias v='nvim'
alias gs='git status'
alias gd='git diff'
alias gl='git log --oneline -15'
alias ..='cd ..'
alias ...='cd ../..'
alias stow-all='cd ~/.dotfiles && stow -v */ && cd -'
alias claude-danger='claude --dangerously-skip-permissions'

# ── Keybindings ──────────────────────────────
bindkey '^[[A' history-substring-search-up
bindkey '^[[B' history-substring-search-down
bindkey '^[[1;5C' forward-word      # Ctrl+Right
bindkey '^[[1;5D' backward-word     # Ctrl+Left
bindkey '^[[3~' delete-char         # Delete
bindkey '^[[H' beginning-of-line    # Home
bindkey '^[[F' end-of-line          # End

# ── Plugins ──────────────────────────────────
[[ -f /usr/share/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh ]] && \
    source /usr/share/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh
[[ -f /usr/share/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh ]] && \
    source /usr/share/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
[[ -f /usr/share/zsh/plugins/zsh-history-substring-search/zsh-history-substring-search.zsh ]] && \
    source /usr/share/zsh/plugins/zsh-history-substring-search/zsh-history-substring-search.zsh

# ── Path ─────────────────────────────────────
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
export VIRTUAL_ENV_DISABLE_PROMPT=1
export EDITOR=nvim

# ── Zoxide (smart cd) ────────────────────────
export _ZO_DOCTOR=0
if command -v zoxide &>/dev/null; then
    eval "$(zoxide init zsh)"
    alias cd='z'
fi

# ── Starship prompt (must be last) ───────────
command -v starship &>/dev/null && eval "$(starship init zsh)"

# ── Fastfetch on start ───────────────────────
command -v fastfetch &>/dev/null && fastfetch --logo arch_small
