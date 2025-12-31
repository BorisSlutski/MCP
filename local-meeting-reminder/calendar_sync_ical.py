#!/usr/bin/env python3
"""
Google Calendar → macOS Reminders Sync (iCal version)
Uses Google Calendar's secret iCal URL - no OAuth setup needed!

To get your iCal URL:
1. Go to calendar.google.com
2. Click gear icon → Settings
3. Click on your calendar (boriss@wix.com)
4. Scroll down to "Secret address in iCal format"
5. Copy the URL and paste it below
"""

import os
import sys
import subprocess
import urllib.request
from datetime import datetime, timedelta
from dateutil import parser as date_parser
import json
import re

# ============================================
# PASTE YOUR ICAL URL HERE:
# ============================================
ICAL_URL = "https://calendar.google.com/calendar/ical/boriss%40wix.com/public/basic.ics"
# ============================================

# Configuration
REMINDER_MINUTES_BEFORE = 3
SYNC_HOURS_AHEAD = 24
REMINDER_LIST_NAME = "Calendar"
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


def load_synced_events():
    """Load previously synced event IDs."""
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, 'r') as f:
                data = json.load(f)
                cutoff = (datetime.now() - timedelta(days=2)).isoformat()
                return {k: v for k, v in data.items() if v.get('synced_at', '') > cutoff}
        except:
            return {}
    return {}


def save_synced_events(synced):
    """Save synced event IDs."""
    with open(STATE_FILE, 'w') as f:
        json.dump(synced, f, indent=2)


def parse_ical(ical_content):
    """Parse iCal content and extract events."""
    events = []
    current_event = None
    
    lines = ical_content.replace('\r\n ', '').replace('\r\n\t', '').split('\r\n')
    
    for line in lines:
        if line == 'BEGIN:VEVENT':
            current_event = {}
        elif line == 'END:VEVENT':
            if current_event:
                events.append(current_event)
            current_event = None
        elif current_event is not None and ':' in line:
            # Handle properties with parameters (like DTSTART;TZID=...)
            if ';' in line.split(':')[0]:
                key_part = line.split(':')[0]
                key = key_part.split(';')[0]
                value = ':'.join(line.split(':')[1:])
            else:
                key, value = line.split(':', 1)
            
            current_event[key] = value
    
    return events


def parse_ical_datetime(dt_str):
    """Parse iCal datetime string."""
    # Remove any timezone suffix
    dt_str = dt_str.replace('Z', '')
    
    try:
        if 'T' in dt_str:
            # Full datetime
            return datetime.strptime(dt_str[:15], '%Y%m%dT%H%M%S')
        else:
            # Date only (all-day event)
            return None
    except:
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
    title = title.replace('"', '\\"').replace("'", "\\'")
    body = body.replace('"', '\\"').replace("'", "\\'")
    
    script = f'''
    tell application "Reminders"
        set myList to list "{REMINDER_LIST_NAME}"
        
        set reminderDate to current date
        set year of reminderDate to {remind_date.year}
        set month of reminderDate to {remind_date.month}
        set day of reminderDate to {remind_date.day}
        set hours of reminderDate to {remind_date.hour}
        set minutes of reminderDate to {remind_date.minute}
        set seconds of reminderDate to 0
        
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


def sync_calendar():
    """Main sync function."""
    log("🔄 Starting calendar sync (iCal)...")
    
    if not ICAL_URL:
        log("❌ ICAL_URL not configured! Edit calendar_sync_ical.py and paste your iCal URL.")
        print("\nTo get your iCal URL:")
        print("1. Go to calendar.google.com")
        print("2. Click gear icon → Settings")
        print("3. Click on your calendar (boriss@wix.com)")
        print("4. Scroll to 'Secret address in iCal format'")
        print("5. Copy the URL")
        print("6. Edit this file and paste it in ICAL_URL")
        return
    
    # Fetch calendar
    try:
        log("📥 Fetching calendar...")
        req = urllib.request.Request(ICAL_URL, headers={'User-Agent': 'CalendarSync/1.0'})
        with urllib.request.urlopen(req, timeout=30) as response:
            ical_content = response.read().decode('utf-8')
    except Exception as e:
        log(f"❌ Failed to fetch calendar: {e}")
        return
    
    ensure_reminder_list_exists()
    synced_events = load_synced_events()
    
    events = parse_ical(ical_content)
    log(f"📅 Found {len(events)} events in calendar")
    
    now = datetime.now()
    cutoff = now + timedelta(hours=SYNC_HOURS_AHEAD)
    new_reminders = 0
    
    for event in events:
        event_id = event.get('UID', '')
        if not event_id:
            continue
        
        # Parse start time
        dtstart = event.get('DTSTART', '')
        start_time = parse_ical_datetime(dtstart)
        
        if not start_time:
            continue  # Skip all-day events
        
        # Skip if not in our window
        if start_time < now or start_time > cutoff:
            continue
        
        # Skip if already synced
        if event_id in synced_events:
            continue
        
        # Calculate reminder time
        remind_time = start_time - timedelta(minutes=REMINDER_MINUTES_BEFORE)
        if remind_time < now:
            continue
        
        # Build reminder
        summary = event.get('SUMMARY', 'Untitled Meeting')
        # Decode iCal escaping
        summary = summary.replace('\\,', ',').replace('\\;', ';').replace('\\n', '\n')
        
        title = f"📅 {summary} - {start_time.strftime('%H:%M')}"
        body = f"Starts at {start_time.strftime('%H:%M')}"
        
        # Check for meeting link in description or location
        description = event.get('DESCRIPTION', '')
        location = event.get('LOCATION', '')
        
        for text in [description, location]:
            if 'zoom.us' in text or 'meet.google.com' in text or 'teams.microsoft.com' in text:
                # Extract URL
                urls = re.findall(r'https://[^\s<>"\'\\]+', text)
                for url in urls:
                    if any(domain in url for domain in ['zoom.us', 'meet.google.com', 'teams.microsoft.com']):
                        body += f"\nJoin: {url}"
                        break
                break
        
        # Create reminder
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
            synced_events[event_id] = {
                'summary': summary,
                'start_time': start_time.isoformat(),
                'synced_at': datetime.now().isoformat()
            }
    
    save_synced_events(synced_events)
    log(f"✅ Sync complete. Created {new_reminders} new reminders.")


if __name__ == '__main__':
    sync_calendar()
