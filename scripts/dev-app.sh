#!/bin/zsh
# Makes a copy of Electron's macOS app bundle named "Readr", so the menu bar,
# Dock and app switcher say Readr when running from this folder (`electron .`
# shows the stock bundle's name, "Electron", which app.setName can't change).
# Runs after every npm install; safe to re-run. Output: node_modules/.dev-app/Readr.app
set -euo pipefail
[[ "$(uname)" == "Darwin" ]] || exit 0
cd "${0:A:h}/.."
src=node_modules/electron/dist/Electron.app
dst=node_modules/.dev-app/Readr.app
[[ -d "$src" ]] || { echo "dev-app: Electron not installed yet, skipping"; exit 0; }
rm -rf "$dst"
mkdir -p node_modules/.dev-app
ditto "$src" "$dst"
plist="$dst/Contents/Info.plist"
for key in CFBundleName CFBundleDisplayName; do
  /usr/libexec/PlistBuddy -c "Set :$key Readr" "$plist" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :$key string Readr" "$plist"
done
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.sparkle.readr.dev" "$plist"
cp build/icon.icns "$dst/Contents/Resources/electron.icns"
# Editing Info.plist breaks Electron's signature; sign the copy locally (ad hoc).
codesign --force --deep --sign - "$dst" >/dev/null 2>&1
echo "dev-app: $dst ready"
