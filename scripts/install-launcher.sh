#!/usr/bin/env bash
# Puts the `jade` command and a desktop launcher in place on a Linux machine (any freedesktop desktop).
#   bash scripts/install-launcher.sh
# Afterwards: `jade` opens Jade (starting the server if needed), `jade --serve` starts the server only, `jade --stop` stops it.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/.." && pwd)"
BIN="$HOME/.local/bin"; APPS="$HOME/.local/share/applications"; ICONS="$HOME/.local/share/icons/hicolor/256x256/apps"
mkdir -p "$BIN" "$APPS" "$ICONS"
# The installed launcher remembers where this checkout is.
sed "s|^APP_DEFAULT=.*|APP_DEFAULT=\"$APP\"|" "$HERE/jade" > "$BIN/jade"
chmod +x "$BIN/jade"
cp "$HERE/jade.png" "$ICONS/jade.png"
sed "s|Exec=.*|Exec=$BIN/jade|" "$HERE/Jade.desktop" > "$APPS/Jade.desktop"
command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
echo "Installed: $BIN/jade and $APPS/Jade.desktop (code: $APP)"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "Note: add $BIN to your PATH to type 'jade' in a terminal";; esac
