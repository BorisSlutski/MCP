#!/bin/bash
# Setup script for Calendar Sync Background Service

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PLIST_NAME="com.boriss.calendar-sync.plist"
PLIST_SOURCE="$SCRIPT_DIR/$PLIST_NAME"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME"

echo "🚀 Calendar Sync Setup"
echo "======================"
echo ""

# Check if credentials.json exists
if [ ! -f "$SCRIPT_DIR/credentials.json" ]; then
    echo "⚠️  credentials.json not found!"
    echo ""
    echo "To set up Google Calendar access:"
    echo "1. Go to https://console.cloud.google.com/"
    echo "2. Create a project (or select existing)"
    echo "3. Enable 'Google Calendar API'"
    echo "4. Go to 'Credentials' → 'Create Credentials' → 'OAuth client ID'"
    echo "5. Select 'Desktop app'"
    echo "6. Download the JSON file"
    echo "7. Rename it to 'credentials.json' and place it in:"
    echo "   $SCRIPT_DIR/"
    echo ""
    echo "Then run this script again."
    exit 1
fi

# Create/activate virtual environment if needed
if [ ! -d "$SCRIPT_DIR/venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv "$SCRIPT_DIR/venv"
fi

echo "📦 Installing dependencies..."
source "$SCRIPT_DIR/venv/bin/activate"
pip install -q -r "$SCRIPT_DIR/requirements.txt"

# Run initial auth (this will open browser for OAuth)
echo ""
echo "🔐 Running initial authentication..."
echo "   A browser window will open for Google OAuth."
echo "   Please authorize access to your calendar."
echo ""
python3 "$SCRIPT_DIR/calendar_sync.py"

# Create Reminders list
echo ""
echo "📋 Creating 'Calendar' list in Reminders app..."
osascript -e 'tell application "Reminders" to if not (exists list "Calendar") then make new list with properties {name:"Calendar"}'

# Install launch agent
echo ""
echo "⚙️  Installing background service..."

# Unload if already loaded
launchctl unload "$PLIST_DEST" 2>/dev/null || true

# Copy plist
cp "$PLIST_SOURCE" "$PLIST_DEST"

# Load the service
launchctl load "$PLIST_DEST"

echo ""
echo "✅ Setup complete!"
echo ""
echo "The sync service is now running and will:"
echo "  • Check your calendar every 30 minutes"
echo "  • Create reminders 3 minutes before each meeting"
echo "  • Reminders appear in the 'Calendar' list"
echo ""
echo "Commands:"
echo "  • Check status:  launchctl list | grep calendar-sync"
echo "  • View logs:     tail -f $SCRIPT_DIR/sync.log"
echo "  • Stop service:  launchctl unload $PLIST_DEST"
echo "  • Start service: launchctl load $PLIST_DEST"
echo "  • Manual sync:   $SCRIPT_DIR/venv/bin/python3 $SCRIPT_DIR/calendar_sync.py"
echo ""
