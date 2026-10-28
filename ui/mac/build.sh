#!/bin/zsh
# Builds ui/Bot.app from Bot.swift with swiftc and signs it ad hoc. Run from anywhere: ui/mac/build.sh
set -euo pipefail
cd ${0:A:h}
app=../Bot.app
rm -rf $app
mkdir -p $app/Contents/MacOS
swiftc -O -o $app/Contents/MacOS/Bot Bot.swift
cat > $app/Contents/Info.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>local.bot.ui</string>
  <key>CFBundleName</key><string>Bot</string>
  <key>CFBundleExecutable</key><string>Bot</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
EOF
codesign --force --sign - $app
echo "Built ${app:A}"
