# 🔔 Local Meeting Reminder

A free, local "In Your Face" style meeting reminder for your Google Calendar.

## Features

- ⏰ **Full-screen blocking alerts** - Can't miss them!
- 🎥 **One-click join** - Automatically detects Zoom/Meet/Teams links
- ⏸️ **Snooze** - 2-minute snooze if you need a moment
- 🔊 **Sound alerts** - Glass sound plays when alert appears
- ⌨️ **Keyboard shortcuts** - Enter to join, Space to snooze, Escape to dismiss
- 💯 **Completely free & local** - No subscriptions, no cloud dependencies

## Quick Start

### 1. Set up Google Cloud credentials (one-time)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the **Google Calendar API**:
   - Go to "APIs & Services" → "Library"
   - Search for "Google Calendar API"
   - Click "Enable"
4. Create OAuth credentials:
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "OAuth client ID"
   - Select "Desktop app"
   - Download the JSON file
5. Rename the downloaded file to `credentials.json` and place it in this folder

### 2. Install dependencies

```bash
cd path/to/local-meeting-reminder
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 3. Run the reminder

```bash
./start.sh
```

Or manually:
```bash
source venv/bin/activate
python meeting_reminder.py
```

### 4. First-time authorization

On first run, a browser window will open asking you to authorize access to your Google Calendar. This is a one-time setup.

## Configuration

Edit `meeting_reminder.py` to customize:

```python
REMINDER_MINUTES_BEFORE = 3   # Alert N minutes before meeting
CHECK_INTERVAL_SECONDS = 30   # How often to check calendar
ALERT_DURATION_SECONDS = 60   # Auto-dismiss after N seconds
```

## Running in Background

### Option 1: Terminal
```bash
nohup ./start.sh > reminder.log 2>&1 &
```

### Option 2: macOS Launch Agent (recommended)

The repository includes `.plist.example` template files. Follow these steps to set up:

#### Step 1: Create your personalized plist file

```bash
# For the meeting reminder (full-screen alerts)
cp com.meeting-reminder.plist.example com.meeting-reminder.plist

# OR for the calendar sync (creates macOS Reminders)
cp com.calendar-sync.plist.example com.calendar-sync.plist
```

#### Step 2: Edit the plist file with your actual paths

Open the copied `.plist` file and replace all `$HOME/local-meeting-reminder` paths with your actual installation path.

For example, if you cloned to `/Users/jane/Projects/local-meeting-reminder`:
```xml
<string>/Users/jane/Projects/local-meeting-reminder/start.sh</string>
```

#### Step 3: Install and load the launch agent

```bash
# Copy to LaunchAgents
cp com.meeting-reminder.plist ~/Library/LaunchAgents/

# Load it
launchctl load ~/Library/LaunchAgents/com.meeting-reminder.plist
```

#### Step 4: Manage the service

```bash
# Check status
launchctl list | grep meeting-reminder

# Stop the service
launchctl unload ~/Library/LaunchAgents/com.meeting-reminder.plist

# Start the service
launchctl load ~/Library/LaunchAgents/com.meeting-reminder.plist
```

## Keyboard Shortcuts (during alert)

| Key | Action |
|-----|--------|
| `Enter` | Join meeting |
| `Space` | Snooze 2 min |
| `Escape` | Dismiss |

## Troubleshooting

### "credentials.json not found"
Download OAuth credentials from Google Cloud Console. See step 1.

### "Token has been expired or revoked"
Delete `token.pickle` and run again to re-authorize.

### Alert window not appearing
Make sure Python has accessibility permissions:
- System Preferences → Security & Privacy → Privacy → Accessibility
- Add Terminal or your Python interpreter

## License

MIT - Use freely!
