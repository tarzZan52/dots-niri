#!/usr/bin/env bash
# set-bg.sh — Set wallpaper + regenerate Material You colors
# Usage: set-bg.sh <path-to-image>
#        set-bg.sh               (picks random from ~/Pictures/Wallpapers)

set -euo pipefail

WALLPAPER_DIR="${WALLPAPER_DIR:-$HOME/Pictures/wallpapers}"

# ─── Resolve image path ──────────────────────────────────────────────────────
if [[ -n "${1:-}" ]]; then
    IMG="$1"
else
    if [[ ! -d "$WALLPAPER_DIR" ]]; then
        echo "No image provided and $WALLPAPER_DIR does not exist." >&2
        exit 1
    fi
    IMG=$(find "$WALLPAPER_DIR" -maxdepth 1 -type f \
        \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \) \
        | shuf -n1)
    if [[ -z "$IMG" ]]; then
        echo "No images found in $WALLPAPER_DIR" >&2
        exit 1
    fi
fi

if [[ ! -f "$IMG" ]]; then
    echo "File not found: $IMG" >&2
    exit 1
fi

echo "[+] Wallpaper: $IMG"

# ─── Set wallpaper via swww ──────────────────────────────────────────────────
swww img "$IMG" \
    --transition-type grow \
    --transition-duration 2

# ─── Generate Material You colors ───────────────────────────────────────────
matugen image "$IMG" -m dark --source-color-index 0

# ─── Reload applications ────────────────────────────────────────────────────

# Niri: matugen writes directly to config.kdl, niri auto-reloads on change
echo "[+] Niri: config updated (auto-reload)"

# Foot: touch main config to trigger reload
if [[ -f "$HOME/.config/foot/foot.ini" ]]; then
    touch "$HOME/.config/foot/foot.ini"
    echo "[+] Foot: colors reloaded"
fi

# AGS: hot-reload CSS without restarting (monitorFile picks up _colors.scss change)
# If monitorFile doesn't fire fast enough, send explicit request
if pgrep -x ags &>/dev/null; then
    sleep 0.3
    ags request reload-css &>/dev/null || true
    echo "[+] AGS: CSS hot-reloaded"
fi

echo "[+] Done. Colors applied from: $(basename "$IMG")"
