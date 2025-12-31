# Local Meeting Reminder

A simple solution to sync your Google Calendar with macOS Reminders using Cursor and MCP-GoogleCalendar.

## How It Works

This solution uses the MCP-GoogleCalendar connection in Cursor to fetch your calendar events and create reminders in the macOS Reminders app.

## Usage

### Sync Calendar (via Cursor)

Just say one of these commands in Cursor:
- **"sync my calendar"** - Fetches next 7 days and creates reminders (3 min before each meeting)

### Cleanup Old Reminders

Run the cleanup script to remove completed or past reminders:

```bash
./cleanup.sh
```

Or add an alias to your `~/.zshrc`:

```bash
alias cleanup-calendar='/Users/XXXX/Documents/CursorReposetory/wix-data-dev-secure/local-meeting-reminder/cleanup.sh'
```

Then just run: `cleanup-calendar`

## Features

- ✅ Syncs with your primary Google Calendar (XXXX@wix.com)
- ✅ Creates reminders 3 minutes before each meeting
- ✅ Includes meeting links (Zoom/Google Meet) in reminder notes
- ✅ Includes location info when available
- ✅ Cleanup script for old/completed reminders
- ✅ All reminders go to a "Calendar" list in macOS Reminders

## Files

| File | Purpose |
|------|---------|
| `cleanup.sh` | Removes completed/past reminders |
| `README.md` | This documentation |

## Requirements

- Cursor with MCP-GoogleCalendar configured
- macOS with Reminders app
- Access to XXXX@wix.com calendar

## Notes

- Reminders are created in a list called "Calendar" in the macOS Reminders app
- Each reminder includes the meeting name, time, and any meeting links
- Say "sync my calendar" whenever you want to refresh your reminders
