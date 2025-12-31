#!/usr/bin/env python3
"""
Google Calendar → macOS Reminders Sync
Automatically creates reminders for upcoming meetings.
Runs every 30 minutes via launchd.
"""

import os
import sys
import subprocess
import pickle
from datetime import datetime, timedelta
from dateutil import parser as date_parser
import json
import re

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Configuration
SCOPES = ['https://www.googleapis.com/auth/calendar.readonly']
REMINDER_MINUTES_BEFORE = 3  # Create reminder N minutes before meeting
SYNC_HOURS_AHEAD = 24  # Sync events for the next N hours
REMINDER_LIST_NAME = "Calendar"  # macOS Reminders list name

# State file to track synced events
STATE_FILE = os.path.join(os.path.dirname(__file__), 'synced_events.json')
LOG_FILE = os.path.join(os.path.dirname(__file__), 'sync.log')


def log(message):
    """Log message to file and stdout."""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_line = f"[{timestamp}] {message}"
    print(log_line)
    try:
        with open(LOG_FILE, 'a') as f:
            f.write(log_line + '\n')
    except:
        pass


def get_calendar_service():
    """Authenticate and return Google Calendar service."""
    creds = None
    token_path = os.path.join(os.path.dirname(__file__), 'token.pickle')
    credentials_path = os.path.join(os.path.dirname(__file__), 'credentials.json')
    
    if os.path.exists(token_path):
        with open(token_path, 'rb') as token:
            creds = pickle.load(token)
    
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(credentials_path):
                log("❌ credentials.json not found! Please set up Google Cloud OAuth.")
                sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(credentials_path, SCOPES)
            creds = flow.run_local_server(port=0)
        
        with open(token_path, 'wb') as token:
            pickle.dump(creds, token)
    
    return build('calendar', 'v3', credentials=creds)


def load_synced_events():
    """Load previously synced event IDs."""
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, 'r') as f:
                data = json.load(f)
                # Clean up old entries (older than 2 days)
                cutoff = (datetime.now() - timedelta(days=2)).isoformat()
                return {k: v for k, v in data.items() if v.get('synced_at', '') > cutoff}
        except:
            return {}
    return {}


def save_synced_events(synced):
    """Save synced event IDs."""
    with open(STATE_FILE, 'w') as f:
        json.dump(synced, f, indent=2)


def extract_meeting_link(event):
    """Extract video conference link from event."""
    if 'hangoutLink' in event:
        return event['hangoutLink']
    
    if 'conferenceData' in event:
        entry_points = event['conferenceData'].get('entryPoints', [])
        for ep in entry_points:
            if ep.get('entryPointType') == 'video':
                return ep.get('uri')
    
    # Check description for links
    description = event.get('description', '')
    patterns = [
        r'https://[^\s]*zoom\.us/[^\s<"\']+',
        r'https://meet\.google\.com/[^\s<"\']+',
        r'https://teams\.microsoft\.com/[^\s<"\']+',
    ]
    for pattern in patterns:
        match = re.search(pattern, description)
        if match:
            return match.group(0)
    
    return None


def ensure_reminder_list_exists():
    """Make sure the Calendar reminder list exists."""
    script = f'''
    tell application "Reminders"
        if not (exists list "{REMINDER_LIST_NAME}") then
            make new list with properties {{name:"{REMINDER_LIST_NAME}"}}
        end if
    end tell
    '''
    subprocess.run(['osascript', '-e', script], capture_output=True)


def create_macos_reminder(event_id, title, body, remind_date):
    """Create a reminder in macOS Reminders app."""
    # Format: "December 31, 2025 at 2:57:00 PM" doesn't work with all locales
    # Use AppleScript date object instead
    
    # Escape quotes in title and body
    title = title.replace('"', '\\"').replace("'", "\\'")
    body = body.replace('"', '\\"').replace("'", "\\'")
    
    script = f'''
    tell application "Reminders"
        set myList to list "{REMINDER_LIST_NAME}"
        
        -- Create date object
        set reminderDate to current date
        set year of reminderDate to {remind_date.year}
        set month of reminderDate to {remind_date.month}
        set day of reminderDate to {remind_date.day}
        set hours of reminderDate to {remind_date.hour}
        set minutes of reminderDate to {remind_date.minute}
        set seconds of reminderDate to 0
        
        -- Check if reminder already exists (by searching for event_id in body)
        set existingReminders to (reminders of myList whose body contains "{event_id}")
        if (count of existingReminders) = 0 then
            make new reminder at myList with properties {{name:"{title}", body:"{body}\\n\\nEvent ID: {event_id}", remind me date:reminderDate}}
            return "created"
        else
            return "exists"
        end if
    end tell
    '''
    
    result = subprocess.run(['osascript', '-e', script], capture_output=True, text=True)
    return result.stdout.strip()


def get_upcoming_events(service):
    """Get events for the next SYNC_HOURS_AHEAD hours."""
    now = datetime.utcnow()
    time_min = now.isoformat() + 'Z'
    time_max = (now + timedelta(hours=SYNC_HOURS_AHEAD)).isoformat() + 'Z'
    
    events_result = service.events().list(
        calendarId='primary',
        timeMin=time_min,
        timeMax=time_max,
        singleEvents=True,
        orderBy='startTime'
    ).execute()
    
    return events_result.get('items', [])


def sync_calendar():
    """Main sync function."""
    log("🔄 Starting calendar sync...")
    
    try:
        service = get_calendar_service()
    except Exception as e:
        log(f"❌ Failed to connect to Google Calendar: {e}")
        return
    
    ensure_reminder_list_exists()
    synced_events = load_synced_events()
    
    events = get_upcoming_events(service)
    new_reminders = 0
    
    for event in events:
        event_id = event['id']
        
        # Skip all-day events
        start = event.get('start', {})
        if 'date' in start and 'dateTime' not in start:
            continue
        
        # Skip cancelled events
        if event.get('status') == 'cancelled':
            continue
        
        # Parse start time
        start_time_str = start.get('dateTime', '')
        if not start_time_str:
            continue
        
        try:
            start_time = date_parser.parse(start_time_str)
        except:
            continue
        
        # Calculate reminder time
        remind_time = start_time - timedelta(minutes=REMINDER_MINUTES_BEFORE)
        
        # Skip if reminder time is in the past
        now = datetime.now(start_time.tzinfo) if start_time.tzinfo else datetime.now()
        if remind_time < now:
            continue
        
        # Skip if already synced
        if event_id in synced_events:
            continue
        
        # Build reminder content
        summary = event.get('summary', 'Untitled Meeting')
        meeting_link = extract_meeting_link(event)
        
        title = f"📅 {summary} - {start_time.strftime('%H:%M')}"
        
        body_parts = [f"Starts at {start_time.strftime('%H:%M')}"]
        if meeting_link:
            body_parts.append(f"Join: {meeting_link}")
        
        # Add attendees info
        attendees = event.get('attendees', [])
        organizer = event.get('organizer', {}).get('email', '')
        if organizer and organizer != 'boriss@wix.com':
            body_parts.append(f"Organizer: {organizer}")
        
        body = '\n'.join(body_parts)
        
        # Create the reminder
        result = create_macos_reminder(event_id, title, body, remind_time)
        
        if result == 'created':
            log(f"✅ Created reminder: {summary} at {start_time.strftime('%H:%M')}")
            new_reminders += 1
            synced_events[event_id] = {
                'summary': summary,
                'start_time': start_time.isoformat(),
                'synced_at': datetime.now().isoformat()
            }
        elif result == 'exists':
            log(f"⏭️ Reminder already exists: {summary}")
            synced_events[event_id] = {
                'summary': summary,
                'start_time': start_time.isoformat(),
                'synced_at': datetime.now().isoformat()
            }
    
    save_synced_events(synced_events)
    log(f"✅ Sync complete. Created {new_reminders} new reminders.")


if __name__ == '__main__':
    sync_calendar()
