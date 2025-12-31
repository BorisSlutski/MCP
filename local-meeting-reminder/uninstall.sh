#!/bin/bash
# Uninstall the Calendar Sync Background Service

PLIST_NAME="com.boriss.calendar-sync.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME"

echo "🛑 Uninstalling Calendar Sync Service..."

# Unload the service
if [ -f "$PLIST_DEST" ]; then
    launchctl unload "$PLIST_DEST" 2>/dev/null || true
    rm "$PLIST_DEST"
    echo "✅ Service uninstalled"
else
    echo "⚠️  Service was not installed"
fi

echo ""
echo "Note: Your credentials and synced data are still in this folder."
echo "Delete the folder to remove everything."
