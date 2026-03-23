#!/usr/bin/env bash
set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${BLUE}::${NC} $1"; }
ok()    { echo -e "  ${GREEN}✓${NC} $1"; }
warn()  { echo -e "  ${YELLOW}!${NC} $1"; }
err()   { echo -e "  ${RED}✗${NC} $1"; }
step()  { echo ""; echo -e "${CYAN}━━━ ${BOLD}$1${NC}"; }

ERRORS=()

# ─── Detect architecture ────────────────────────────────────────────────────
detect_arch() {
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64)         ARCH="x86_64" ;;
        aarch64|arm64)  ARCH="aarch64" ;;
        armv7l)         ARCH="armv7" ;;
    esac
    info "Architecture: ${BOLD}$ARCH${NC}"
}

# ─── Detect runtime environment ─────────────────────────────────────────────
detect_env() {
    ENV="bare-metal"

    if systemd-detect-virt --quiet 2>/dev/null; then
        local virt
        virt=$(systemd-detect-virt 2>/dev/null || true)
        case "$virt" in
            vmware)      ENV="vmware" ;;
            kvm|qemu)    ENV="qemu" ;;
            oracle)      ENV="virtualbox" ;;
            none)        ENV="bare-metal" ;;
            *)           ENV="$virt" ;;
        esac
    elif [[ -f /sys/class/dmi/id/product_name ]]; then
        local product
        product=$(cat /sys/class/dmi/id/product_name 2>/dev/null | tr '[:upper:]' '[:lower:]')
        [[ "$product" == *vmware* ]]     && ENV="vmware"
        [[ "$product" == *virtualbox* ]] && ENV="virtualbox"
        [[ "$product" == *qemu* ]]       && ENV="qemu"
    fi

    info "Environment: ${BOLD}$ENV${NC}"
}

# ─── Bootstrap paru ─────────────────────────────────────────────────────────
bootstrap_paru() {
    info "Installing paru (AUR helper)..."
    local paru_deps=(base-devel git)
    # paru source build needs rust on non-x86_64
    [[ "$ARCH" != "x86_64" ]] && paru_deps+=(rust)
    sudo pacman -S --needed --noconfirm "${paru_deps[@]}"

    # (Re)build paru if missing or broken (e.g. libalpm version mismatch after pacman -Syu)
    if paru --version &>/dev/null 2>&1; then
        ok "paru already installed and working"
        return
    fi

    if command -v paru &>/dev/null; then
        warn "paru binary exists but is broken (likely libalpm mismatch) — rebuilding..."
    fi

    local tmp
    tmp=$(mktemp -d)
    # Remove conflicting paru variant before installing
    sudo pacman -Rdd --noconfirm paru-bin 2>/dev/null || true
    sudo pacman -Rdd --noconfirm paru 2>/dev/null || true

    if [[ "$ARCH" == "x86_64" ]]; then
        git clone https://aur.archlinux.org/paru-bin.git "$tmp/paru"
    else
        info "Building paru from source for $ARCH..."
        git clone https://aur.archlinux.org/paru.git "$tmp/paru"
    fi
    (cd "$tmp/paru" && makepkg -si --noconfirm)
    rm -rf "$tmp"

    if paru --version &>/dev/null 2>&1; then
        ok "paru installed"
    else
        err "paru installation failed"
        ERRORS+=("paru installation failed")
    fi
}

# ─── Package lists ──────────────────────────────────────────────────────────

# Core system + desktop
PACMAN_PKGS=(
    # build essentials
    base-devel git curl rsync unzip stow

    # shell
    zsh starship zoxide fastfetch
    zsh-autosuggestions zsh-syntax-highlighting

    # terminal
    foot

    # wayland compositor deps
    polkit-gnome xdg-desktop-portal xdg-desktop-portal-gtk
    mesa xorg-xwayland

    # networking
    networkmanager

    # wayland utilities
    wl-clipboard grim slurp libnotify xdg-utils

    # theming & css
    dart-sass

    # node & go (for AGS)
    nodejs npm go

    # pixbuf (clipboard thumbnails)
    gdk-pixbuf2

    # editor
    neovim

    # file manager
    thunar

    # media & audio
    pipewire wireplumber pipewire-pulse pipewire-alsa
    playerctl brightnessctl

    # clipboard history
    cliphist

    # compositor & wallpaper (in extra repo)
    niri swww

    # fonts
    ttf-jetbrains-mono-nerd noto-fonts noto-fonts-cjk noto-fonts-emoji

    # gtk
    gtk-layer-shell

    # github cli
    github-cli
)

# AUR packages
AUR_PKGS=(
    # widget shell (AGS v3 + astal libs)
    aylurs-gtk-shell
    libastal-git
    libastal-4-git
    libastal-io-git
    libastal-tray-git
    libastal-notifd-git
    libastal-apps-git
)

# VMware x86-only drivers
VMWARE_PKGS_X86=(xf86-video-vmware xf86-input-vmmouse)

# ─── Install packages ───────────────────────────────────────────────────────
install_pacman() {
    step "Step 1/7 — System packages (pacman)"

    # Ensure DNS works (VMware NAT DNS can be flaky)
    if ! grep -q '^nameserver 8.8.8.8' /etc/resolv.conf 2>/dev/null; then
        info "Adding fallback DNS (8.8.8.8)..."
        sudo sed -i '1i nameserver 8.8.8.8' /etc/resolv.conf
    fi

    # Refresh pacman keyring (ARM images may have stale keys)
    info "Refreshing pacman keyring..."
    sudo pacman-key --init 2>/dev/null || true
    sudo pacman-key --populate 2>/dev/null || true

    info "Updating system and installing packages..."
    if ! sudo pacman -Syu --needed --noconfirm "${PACMAN_PKGS[@]}"; then
        warn "Some pacman packages may have failed — check output above"
        ERRORS+=("Some pacman packages failed")
    fi

    # Rebuild font cache after installing fonts
    sudo fc-cache -f 2>/dev/null || true
}

install_aur() {
    step "Step 2/7 — AUR packages"
    if ! paru --version &>/dev/null 2>&1; then
        err "paru not working — cannot install AUR packages"
        ERRORS+=("AUR packages not installed")
        return
    fi

    # On aarch64, AUR PKGBUILDs lack arch support — use --ignorearch
    local paru_flags=(--needed --noconfirm)
    [[ "$ARCH" != "x86_64" ]] && paru_flags+=(--mflags='--ignorearch')

    info "Installing AUR packages with paru..."
    if ! paru -S "${paru_flags[@]}" "${AUR_PKGS[@]}"; then
        warn "Some AUR packages may have failed — check output above"
        ERRORS+=("Some AUR packages failed")
    fi

    # matugen: use prebuilt binary on x86_64, build from source on ARM
    if ! command -v matugen &>/dev/null; then
        if [[ "$ARCH" == "x86_64" ]]; then
            info "Installing matugen-bin (prebuilt x86_64)..."
            paru -S --needed --noconfirm matugen-bin || {
                warn "matugen-bin failed, trying source build..."
                paru -S "${paru_flags[@]}" matugen
            }
        else
            info "Installing matugen (source build for $ARCH)..."
            paru -S "${paru_flags[@]}" matugen
        fi
    else
        ok "matugen already installed"
    fi
}

install_vmware_extras() {
    if [[ "$ENV" != "vmware" ]]; then
        return
    fi

    step "Step 2.5 — VMware extras"

    # Fix TTY: remove kmscon if present, ensure getty@tty1
    if pacman -Qi kmscon &>/dev/null; then
        info "Removing kmscon..."
        sudo pacman -Rns --noconfirm kmscon && ok "kmscon removed" || true
    fi
    sudo systemctl enable getty@tty1.service 2>/dev/null || true
    sudo systemctl set-default multi-user.target
    ok "TTY1 getty enabled, multi-user target set"

    # Install open-vm-tools
    if pacman -Qi open-vm-tools &>/dev/null; then
        ok "open-vm-tools already installed"
    elif [[ "$ARCH" == "x86_64" ]]; then
        # x86_64: available in official repos
        sudo pacman -S --needed --noconfirm open-vm-tools && \
            ok "open-vm-tools installed" || warn "open-vm-tools install failed"
    else
        # aarch64: not in repos, build from Arch packaging with patches
        info "Building open-vm-tools from source for $ARCH..."
        sudo pacman -S --needed --noconfirm \
            fuse3 gtkmm3 libcanberra libdnet libmspack libsigc++ \
            libxss open-iscsi procps-ng uriparser xmlsec rpcsvc-proto

        local build_dir
        build_dir=$(mktemp -d)
        (
            cd "$build_dir"
            git clone --depth=1 https://gitlab.archlinux.org/archlinux/packaging/packages/open-vm-tools.git
            cd open-vm-tools

            # Patch PKGBUILD: allow aarch64 + CFLAGS fix
            sed -i "s/arch=('x86_64')/arch=('x86_64' 'aarch64')/" PKGBUILD
            sed -i '/^build[[:space:]]*()[[:space:]]*{/a\  export CFLAGS="$CFLAGS -Wno-discarded-qualifiers"' PKGBUILD

            # Append glib stubs patch to prepare()
            sed -i '/^prepare()[[:space:]]*{/a\  local _glib="${srcdir}/${pkgname}/open-vm-tools/lib/rpcChannel/glib_stubs.c"\n  if [[ -f "$_glib" ]]; then sed -i "/void g_free/i #undef g_free" "$_glib"; fi' PKGBUILD

            # Build and install
            makepkg -si --noconfirm
        ) && ok "open-vm-tools built and installed" || {
            warn "open-vm-tools build failed"
            ERRORS+=("open-vm-tools build from source failed")
        }
        rm -rf "$build_dir"
    fi

    # x86-only video/input drivers
    if [[ "$ARCH" == "x86_64" ]]; then
        sudo pacman -S --needed --noconfirm "${VMWARE_PKGS_X86[@]}" || \
            warn "VMware x86 drivers may have failed"
    fi

    # Enable VMware services
    sudo systemctl enable --now vmtoolsd.service 2>/dev/null && \
        ok "vmtoolsd enabled" || warn "Could not enable vmtoolsd"
    sudo systemctl enable --now vmware-vmblock-fuse.service 2>/dev/null && \
        ok "vmware-vmblock-fuse enabled" || warn "Could not enable vmware-vmblock-fuse"
}

# ─── Setup AGS (npm install) ────────────────────────────────────────────────
setup_ags() {
    step "Step 3/7 — AGS widget shell setup"

    local ags_dir="$HOME/.config/ags"

    # Check AGS is installed (provides /usr/share/ags/js)
    if [[ ! -d "/usr/share/ags/js" ]]; then
        err "AGS not installed (/usr/share/ags/js missing)"
        err "Install aylurs-gtk-shell from AUR first"
        ERRORS+=("AGS not installed — npm dependencies will fail")
        return
    fi

    if [[ ! -f "$ags_dir/package.json" ]]; then
        warn "AGS config not found at $ags_dir — run stow first"
        return
    fi

    # Clean stale node_modules if AGS was updated
    if [[ -L "$ags_dir/node_modules/ags" ]]; then
        local target
        target=$(readlink -f "$ags_dir/node_modules/ags" 2>/dev/null || true)
        if [[ ! -d "$target" ]]; then
            info "Cleaning stale node_modules (AGS updated)..."
            rm -rf "$ags_dir/node_modules"
        fi
    fi

    info "Installing AGS npm dependencies..."
    # Remove lock file to regenerate with current system paths
    rm -f "$ags_dir/package-lock.json"
    (cd "$ags_dir" && npm install 2>&1) && \
        ok "AGS npm dependencies installed" || {
            warn "npm install failed — trying with legacy peer deps"
            (cd "$ags_dir" && npm install --legacy-peer-deps 2>&1) && \
                ok "AGS npm dependencies installed (legacy)" || {
                    err "AGS npm install failed"
                    ERRORS+=("AGS npm install failed")
                }
        }

    # Compile SCSS once
    if command -v sass &>/dev/null && [[ -f "$ags_dir/style.scss" ]]; then
        info "Compiling AGS styles..."
        sass --no-source-map --style=compressed \
            "$ags_dir/style.scss" "$ags_dir/style-compiled.css" && \
            ok "SCSS compiled" || warn "SCSS compilation failed"
    fi
}

# ─── Deploy dotfiles via stow ───────────────────────────────────────────────
deploy_stow() {
    step "Step 4/7 — Deploying symlinks via stow"

    local stow_pkgs=(
        niri
        ags
        foot
        matugen
        scripts
        zsh
    )

    mkdir -p "$HOME/.config" "$HOME/.local/bin" "$HOME/.local/share/applications"

    for pkg in "${stow_pkgs[@]}"; do
        local pkg_dir="$DOTFILES_DIR/$pkg"
        if [[ -d "$pkg_dir" ]]; then
            # Check if pkg has any files (skip empty dirs)
            if [[ -z "$(find "$pkg_dir" -type f 2>/dev/null | head -1)" ]]; then
                warn "Skipping $pkg (empty)"
                continue
            fi
            info "Stowing ${BOLD}$pkg${NC}..."
            # --adopt: take over existing files (e.g. .zshrc) into stow management
            stow --dir="$DOTFILES_DIR" --target="$HOME" --adopt --restow "$pkg" && \
                ok "$pkg" || { err "Failed to stow $pkg"; ERRORS+=("stow $pkg failed"); }
        else
            warn "Skipping $pkg (not found)"
        fi
    done

    # Restore dotfiles content after --adopt (adopt may overwrite repo files)
    info "Restoring dotfiles from git..."
    (cd "$DOTFILES_DIR" && git checkout -- . 2>/dev/null) && \
        ok "Dotfiles restored" || warn "git checkout failed"
}

# ─── Generate Material You colors ───────────────────────────────────────────
setup_colors() {
    step "Step 5/7 — Material You color generation"

    local wp_dir="$HOME/Pictures/wallpapers"
    mkdir -p "$wp_dir"
    # Create dirs matugen expects for templates
    mkdir -p "$HOME/.config/gtk-3.0" "$HOME/.config/gtk-4.0"
    mkdir -p "$HOME/.dotfiles/ags/.config/ags/scss" 2>/dev/null || true

    # Copy bundled wallpapers if present
    if [[ -d "$DOTFILES_DIR/wallpapers" ]]; then
        cp -n "$DOTFILES_DIR/wallpapers/"* "$wp_dir/" 2>/dev/null || true
        ok "Bundled wallpapers copied"
    fi

    # Find a wallpaper to generate colors from
    local wallpaper=""
    if [[ -d "$wp_dir" ]]; then
        wallpaper=$(find "$wp_dir" -type f \( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" \) | head -1)
    fi

    if [[ -n "$wallpaper" ]] && command -v matugen &>/dev/null; then
        info "Generating colors from: $(basename "$wallpaper")"
        matugen image "$wallpaper" -m dark --source-color-index 0 && \
            ok "Material You colors generated" || \
            warn "matugen failed — colors will be generated on first login"
    else
        warn "No wallpaper found or matugen not installed — skipping color generation"
        info "Place wallpapers in ${BOLD}~/Pictures/wallpapers/${NC}"
    fi
}

# ─── Shell & services ───────────────────────────────────────────────────────
setup_shell_and_services() {
    step "Step 6/7 — Shell & services"

    # Change default shell to zsh
    local current_shell
    current_shell="$(getent passwd "$USER" | cut -d: -f7)"
    if [[ "$current_shell" != "$(command -v zsh)" ]]; then
        info "Changing default shell to zsh..."
        if chsh -s "$(command -v zsh)"; then
            ok "Default shell → zsh"
        else
            warn "Could not change shell — run: chsh -s $(command -v zsh)"
            ERRORS+=("Failed to set zsh as default shell")
        fi
    else
        ok "Default shell is already zsh"
    fi

    # Enable NetworkManager
    info "Enabling NetworkManager..."
    sudo systemctl enable --now NetworkManager.service 2>/dev/null && \
        ok "NetworkManager" || warn "NetworkManager failed"

    # Enable audio
    info "Enabling audio services..."
    systemctl --user enable --now pipewire.socket 2>/dev/null && \
        ok "pipewire" || warn "pipewire failed"
    systemctl --user enable --now wireplumber.service 2>/dev/null && \
        ok "wireplumber" || warn "wireplumber failed"
    systemctl --user enable --now pipewire-pulse.socket 2>/dev/null && \
        ok "pipewire-pulse" || warn "pipewire-pulse failed"

    # Create required directories
    mkdir -p "$HOME/Pictures/Screenshots"
    ok "Directories created"
}

# ─── Verify ─────────────────────────────────────────────────────────────────
verify() {
    step "Step 7/7 — Verification"

    echo ""
    info "Checking core binaries..."
    local bins=(
        niri foot ags sass matugen swww stow
        zsh starship zoxide fastfetch nvim
        grim slurp wl-copy cliphist
        playerctl brightnessctl nmcli
        thunar
    )
    for cmd in "${bins[@]}"; do
        if command -v "$cmd" &>/dev/null; then
            ok "$cmd"
        else
            err "$cmd not found"
            ERRORS+=("Missing: $cmd")
        fi
    done

    echo ""
    info "Checking fonts..."
    sudo fc-cache -f 2>/dev/null || fc-cache -f 2>/dev/null || true
    if command -v fc-list &>/dev/null; then
        for font in "JetBrainsMono Nerd Font" "Noto Sans"; do
            if fc-list 2>/dev/null | grep -qi "$font"; then
                ok "$font"
            else
                err "$font not found"
                ERRORS+=("Missing font: $font")
            fi
        done
    fi

    echo ""
    info "Checking AGS setup..."
    if [[ -d "$HOME/.config/ags/node_modules" ]]; then
        ok "AGS node_modules"
    else
        err "AGS node_modules missing — run: cd ~/.config/ags && npm install"
        ERRORS+=("AGS node_modules missing")
    fi

    echo ""
    info "Checking stow symlinks..."
    for target in niri/config.kdl ags/app.ts foot/foot.ini; do
        if [[ -L "$HOME/.config/$target" ]] || [[ -f "$HOME/.config/$target" ]]; then
            ok "$target"
        else
            err "$target not linked"
            ERRORS+=("Not linked: $target")
        fi
    done
}

# ─── Main ───────────────────────────────────────────────────────────────────
main() {
    echo ""
    echo -e "${CYAN}┌────────────────────────────────────────┐${NC}"
    echo -e "${CYAN}│${NC}  ${BOLD}dots-niri${NC} installer // tarzZan52     ${CYAN}│${NC}"
    echo -e "${CYAN}│${NC}  Niri · AGS · Material You · Arch      ${CYAN}│${NC}"
    echo -e "${CYAN}└────────────────────────────────────────┘${NC}"
    echo ""

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
        install_pacman
        bootstrap_paru
        install_aur
        install_vmware_extras
    fi

    if ! $skip_stow; then
        deploy_stow
    fi

    # AGS setup (always, needs stow first)
    setup_ags

    if ! $skip_install; then
        setup_colors
        setup_shell_and_services
    fi

    verify

    # ── Summary ──
    echo ""
    if [[ ${#ERRORS[@]} -eq 0 ]]; then
        echo -e "${GREEN}┌────────────────────────────────────────┐${NC}"
        echo -e "${GREEN}│${NC}  Installation complete! ${GREEN}✓${NC}              ${GREEN}│${NC}"
        echo -e "${GREEN}│${NC}  Log out and start ${BOLD}niri${NC} from TTY.     ${GREEN}│${NC}"
        echo -e "${GREEN}└────────────────────────────────────────┘${NC}"
    else
        echo -e "${YELLOW}┌────────────────────────────────────────┐${NC}"
        echo -e "${YELLOW}│${NC}  Done with ${#ERRORS[@]} warning(s)                ${YELLOW}│${NC}"
        echo -e "${YELLOW}└────────────────────────────────────────┘${NC}"
        echo ""
        for e in "${ERRORS[@]}"; do
            err "$e"
        done
    fi

    echo ""
    info "Keybinds:"
    echo -e "  ${BOLD}Mod+T${NC}         terminal"
    echo -e "  ${BOLD}Mod+D${NC}         app launcher"
    echo -e "  ${BOLD}Mod+N${NC}         sidebar"
    echo -e "  ${BOLD}Mod+C${NC}         clipboard"
    echo -e "  ${BOLD}Mod+W${NC}         random wallpaper"
    echo -e "  ${BOLD}Mod+Shift+S${NC}   screenshot (area)"
    echo ""
}

main "$@"
