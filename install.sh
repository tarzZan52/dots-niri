#!/usr/bin/env bash
# ~/.dotfiles/install.sh
# Modular dotfiles installer for Arch Linux (ARM + VMware aware)

set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

log()    { echo -e "${GREEN}[+]${RESET} $*"; }
warn()   { echo -e "${YELLOW}[!]${RESET} $*"; }
error()  { echo -e "${RED}[✗]${RESET} $*" >&2; }
section(){ echo -e "\n${BOLD}${CYAN}══ $* ══${RESET}"; }

# ─── Detect architecture ──────────────────────────────────────────────────────
detect_arch() {
    local arch
    arch=$(uname -m)
    case "$arch" in
        x86_64)         ARCH="x86_64" ;;
        aarch64|arm64)  ARCH="aarch64" ;;
        armv7l)         ARCH="armv7" ;;
        *)              ARCH="$arch" ;;
    esac
    log "Architecture: ${BOLD}$ARCH${RESET}"
}

# ─── Detect runtime environment ───────────────────────────────────────────────
detect_env() {
    ENV="bare-metal"

    # Check for VMware
    if systemd-detect-virt --quiet 2>/dev/null; then
        local virt
        virt=$(systemd-detect-virt 2>/dev/null || true)
        case "$virt" in
            vmware)  ENV="vmware" ;;
            kvm)     ENV="kvm" ;;
            qemu)    ENV="qemu" ;;
            oracle)  ENV="virtualbox" ;;
            none)    ENV="bare-metal" ;;
            *)       ENV="$virt" ;;
        esac
    # Fallback: check DMI
    elif [[ -f /sys/class/dmi/id/product_name ]]; then
        local product
        product=$(cat /sys/class/dmi/id/product_name 2>/dev/null | tr '[:upper:]' '[:lower:]')
        case "$product" in
            *vmware*)   ENV="vmware" ;;
            *virtualbox*|*vbox*) ENV="virtualbox" ;;
            *qemu*)     ENV="qemu" ;;
        esac
    fi

    log "Environment: ${BOLD}$ENV${RESET}"
}

# ─── Bootstrap paru (AUR helper) ──────────────────────────────────────────────
bootstrap_paru() {
    if command -v paru &>/dev/null; then
        log "paru already installed, skipping"
        return
    fi

    log "Installing paru..."
    sudo pacman -S --needed --noconfirm base-devel git

    local tmp
    tmp=$(mktemp -d)
    git clone https://aur.archlinux.org/paru-bin.git "$tmp/paru"
    (cd "$tmp/paru" && makepkg -si --noconfirm)
    rm -rf "$tmp"
}

# ─── Package lists ────────────────────────────────────────────────────────────
PACMAN_PKGS=(
    stow
    foot
    git
    base-devel
    pipewire
    wireplumber
    brightnessctl
    playerctl
    networkmanager
)

# Packages from AUR or official depending on availability
AUR_PKGS=(
    niri
    ags
    anyrun-git
    matugen-bin
    hyprlock
    swww
)

# Extra VMware packages
VMWARE_PKGS=(
    open-vm-tools
    xf86-video-vmware
    xf86-input-vmmouse
)

# ARM-specific overrides / exclusions
ARM_EXCLUDE=(
    xf86-video-vmware   # no vmware gpu on arm
    xf86-input-vmmouse
)

# ─── Install packages ─────────────────────────────────────────────────────────
install_pacman() {
    section "pacman packages"
    sudo pacman -Syu --needed --noconfirm "${PACMAN_PKGS[@]}"
}

install_aur() {
    section "AUR packages"
    paru -S --needed --noconfirm "${AUR_PKGS[@]}"
}

install_env_extras() {
    if [[ "$ENV" == "vmware" ]]; then
        section "VMware extras"

        local pkgs=()
        for pkg in "${VMWARE_PKGS[@]}"; do
            # Skip packages excluded for current architecture
            local skip=false
            for excl in "${ARM_EXCLUDE[@]}"; do
                if [[ "$pkg" == "$excl" && "$ARCH" == "aarch64" ]]; then
                    warn "Skipping $pkg (not supported on $ARCH)"
                    skip=true
                    break
                fi
            done
            $skip || pkgs+=("$pkg")
        done

        [[ ${#pkgs[@]} -gt 0 ]] && sudo pacman -S --needed --noconfirm "${pkgs[@]}"

        # Enable VMware services
        sudo systemctl enable --now vmtoolsd.service vmware-vmblock-fuse.service 2>/dev/null || \
            warn "Could not enable VMware services (maybe not running inside VMware?)"
    fi
}

# ─── Deploy dotfiles via stow ─────────────────────────────────────────────────
deploy_stow() {
    section "Deploying symlinks via stow"

    local dotfiles_dir
    dotfiles_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    # Packages to stow (directory names inside ~/.dotfiles)
    local stow_pkgs=(
        niri
        ags
        anyrun
        foot
        hyprlock
        swww
        matugen
    )

    mkdir -p "$HOME/.config"

    for pkg in "${stow_pkgs[@]}"; do
        local pkg_dir="$dotfiles_dir/$pkg"
        if [[ -d "$pkg_dir" ]]; then
            log "Stowing ${BOLD}$pkg${RESET}..."
            stow --dir="$dotfiles_dir" --target="$HOME" --restow "$pkg"
        else
            warn "Skipping $pkg (directory not found: $pkg_dir)"
        fi
    done

    log "All symlinks deployed to ${BOLD}~/.config${RESET}"
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
    section "Dotfiles Installer"
    echo -e "  Arch Linux · Modular · Stow-based\n"

    detect_arch
    detect_env

    local skip_install=false
    local skip_stow=false

    for arg in "$@"; do
        case "$arg" in
            --stow-only)    skip_install=true ;;
            --install-only) skip_stow=true ;;
            --help|-h)
                echo "Usage: $0 [--stow-only] [--install-only]"
                echo "  --stow-only     Skip package installation, only deploy symlinks"
                echo "  --install-only  Install packages but do not stow"
                exit 0
                ;;
        esac
    done

    if ! $skip_install; then
        bootstrap_paru
        install_pacman
        install_aur
        install_env_extras
    fi

    if ! $skip_stow; then
        deploy_stow
    fi

    section "Done"
    log "Installation complete. Log out and start niri."
}

main "$@"
