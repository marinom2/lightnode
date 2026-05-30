#!/usr/bin/env bash
# LightNode Linux installer - one command, any distro.
#
#   curl -fsSL https://lightnode.app/install.sh | bash
#
# It detects your package manager, downloads the right installer from the latest
# GitHub release, installs the runtime libraries the app needs (WebKitGTK 4.1,
# FUSE), and adds LightNode to your apps menu. No manual chmod, no guessing which
# file to grab.
set -euo pipefail

REPO="marinom2/lightnode"
API="https://api.github.com/repos/${REPO}/releases/latest"

echo "==> LightNode installer"

have() { command -v "$1" >/dev/null 2>&1; }

# Need curl to fetch the release + asset.
have curl || { echo "ERROR: 'curl' is required. Install it first (e.g. sudo apt install curl), then re-run."; exit 1; }

# Root vs sudo. Package installs and dependency resolution need elevated rights.
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if have sudo; then SUDO="sudo"; else echo "ERROR: run as root or install 'sudo'."; exit 1; fi
fi

# Detect the native package manager - this decides which release asset we want.
PKG=""
if have apt-get; then PKG="apt"
elif have dnf; then PKG="dnf"
elif have zypper; then PKG="zypper"
elif have pacman; then PKG="pacman"
fi

case "$PKG" in
  apt) WANT=".deb" ;;
  dnf | zypper) WANT=".rpm" ;;
  *) WANT=".AppImage" ;; # pacman / unknown: the portable AppImage runs anywhere
esac

# Resolve the matching asset URL from the latest release (grep/sed so no jq dep).
asset_url() {
  local ext="$1"
  curl -fsSL "$API" \
    | grep -oE '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]+"' \
    | sed -E 's/.*"(https[^"]+)".*/\1/' \
    | grep -iE "${ext}\$" | head -1
}

echo "==> finding the latest release..."
URL="$(asset_url "$WANT" || true)"
# Fall back to the universal AppImage if this distro's package isn't published.
if [ -z "${URL:-}" ]; then
  URL="$(asset_url ".AppImage" || true)"
  WANT=".AppImage"
fi
[ -n "${URL:-}" ] || { echo "ERROR: no Linux installer found in the latest release. See https://github.com/${REPO}/releases/latest"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FILE="$TMP/$(basename "$URL")"
echo "==> downloading $(basename "$URL")..."
curl -fSL "$URL" -o "$FILE"

case "$WANT" in
  .deb)
    echo "==> installing (apt resolves WebKitGTK and other libraries automatically)..."
    $SUDO apt-get update -y >/dev/null 2>&1 || true
    # apt-get can install a local .deb AND pull its dependencies; fall back to
    # dpkg + 'apt-get -f install' on older apt that can't take a file path.
    if ! $SUDO apt-get install -y "$FILE" 2>/dev/null; then
      $SUDO dpkg -i "$FILE" || true
      $SUDO apt-get -f install -y
    fi
    echo "==> done. Open 'LightNode' from your apps menu (or run: lightnode)."
    ;;
  .rpm)
    echo "==> installing..."
    if [ "$PKG" = "dnf" ]; then $SUDO dnf install -y "$FILE"; else $SUDO zypper --non-interactive install --allow-unsigned-rpm "$FILE"; fi
    echo "==> done. Open 'LightNode' from your apps menu."
    ;;
  .AppImage)
    echo "==> setting up the AppImage..."
    # The AppImage needs FUSE 2 and WebKitGTK 4.1 present. Install them where we
    # know the package names (best-effort; never fatal).
    if [ "$PKG" = "apt" ]; then $SUDO apt-get install -y libfuse2 libwebkit2gtk-4.1-0 >/dev/null 2>&1 || true
    elif [ "$PKG" = "pacman" ]; then $SUDO pacman -S --needed --noconfirm fuse2 webkit2gtk-4.1 >/dev/null 2>&1 || true
    fi
    DEST="$HOME/.local/bin"
    mkdir -p "$DEST"
    install -m 0755 "$FILE" "$DEST/LightNode.AppImage"
    APPS="$HOME/.local/share/applications"
    mkdir -p "$APPS"
    cat > "$APPS/lightnode.desktop" <<DESKTOP
[Desktop Entry]
Name=LightNode
Comment=Run a LightChain AI worker in one click
Exec=$DEST/LightNode.AppImage
Type=Application
Categories=Utility;Network;
Terminal=false
DESKTOP
    update-desktop-database "$APPS" >/dev/null 2>&1 || true
    echo "==> done. Open 'LightNode' from your apps menu (or run: $DEST/LightNode.AppImage)."
    case ":$PATH:" in *":$DEST:"*) ;; *) echo "    (tip: add $DEST to your PATH to launch it by name.)" ;; esac
    ;;
esac

echo "==> LightNode installed. Open it and press Install to set up your worker."
