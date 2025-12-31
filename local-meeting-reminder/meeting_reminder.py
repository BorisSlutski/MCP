#!/usr/bin/env python3
"""
Local Meeting Reminder - "In Your Face" style alerts for your Google Calendar
Free & Local - No subscription needed!
"""

import os
import sys
import time
import webbrowser
import subprocess
import threading
from datetime import datetime, timedelta
from dateutil import parser as date_parser
import pickle
import re

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# If modifying these scopes, delete the file token.pickle.
SCOPES = ['https://www.googleapis.com/auth/calendar.readonly']

# Configuration
REMINDER_MINUTES_BEFORE = 3  # Alert this many minutes before meeting
CHECK_INTERVAL_SECONDS = 30  # How often to check for upcoming meetings
ALERT_DURATION_SECONDS = 60  # How long the alert stays on screen


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
                print("❌ credentials.json not found!")
                print("   Please download it from Google Cloud Console.")
                print("   See README.md for instructions.")
                sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(credentials_path, SCOPES)
            creds = flow.run_local_server(port=0)
        
        with open(token_path, 'wb') as token:
            pickle.dump(creds, token)
    
    return build('calendar', 'v3', credentials=creds)


def get_upcoming_events(service, minutes_ahead=10):
    """Get events starting within the next N minutes."""
    now = datetime.utcnow()
    time_min = now.isoformat() + 'Z'
    time_max = (now + timedelta(minutes=minutes_ahead)).isoformat() + 'Z'
    
    events_result = service.events().list(
        calendarId='primary',
        timeMin=time_min,
        timeMax=time_max,
        singleEvents=True,
        orderBy='startTime'
    ).execute()
    
    return events_result.get('items', [])


def extract_meeting_link(event):
    """Extract video conference link from event."""
    # Check for hangout/meet link
    if 'hangoutLink' in event:
        return event['hangoutLink']
    
    # Check for conference data (Zoom, Teams, etc.)
    if 'conferenceData' in event:
        entry_points = event['conferenceData'].get('entryPoints', [])
        for ep in entry_points:
            if ep.get('entryPointType') == 'video':
                return ep.get('uri')
    
    # Check description for links
    description = event.get('description', '')
    # Common video conference patterns
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


def show_macos_notification(title, message, sound=True):
    """Show a macOS notification."""
    sound_cmd = 'with sound "Glass"' if sound else ''
    script = f'''
    display notification "{message}" with title "{title}" {sound_cmd}
    '''
    subprocess.run(['osascript', '-e', script], capture_output=True)


def show_fullscreen_alert(event, meeting_link=None):
    """Show a full-screen blocking alert using tkinter."""
    try:
        import tkinter as tk
        from tkinter import font as tkfont
    except ImportError:
        print("tkinter not available, falling back to notification")
        show_macos_notification(
            "🔔 Meeting Starting!",
            event.get('summary', 'Untitled Meeting')
        )
        return
    
    def join_meeting():
        if meeting_link:
            webbrowser.open(meeting_link)
        root.destroy()
    
    def dismiss():
        root.destroy()
    
    def snooze(minutes=2):
        root.destroy()
        # Schedule another alert
        threading.Timer(minutes * 60, lambda: show_fullscreen_alert(event, meeting_link)).start()
    
    # Create fullscreen window
    root = tk.Tk()
    root.title("Meeting Reminder")
    
    # Make it fullscreen and always on top
    root.attributes('-fullscreen', True)
    root.attributes('-topmost', True)
    root.configure(bg='#1a1a2e')
    
    # Get screen dimensions
    screen_width = root.winfo_screenwidth()
    screen_height = root.winfo_screenheight()
    
    # Fonts
    title_font = tkfont.Font(family="SF Pro Display", size=72, weight="bold")
    time_font = tkfont.Font(family="SF Pro Display", size=36)
    button_font = tkfont.Font(family="SF Pro Display", size=24, weight="bold")
    
    # Main container
    main_frame = tk.Frame(root, bg='#1a1a2e')
    main_frame.place(relx=0.5, rely=0.5, anchor='center')
    
    # Clock icon / emoji
    clock_label = tk.Label(main_frame, text="⏰", font=("Apple Color Emoji", 100), bg='#1a1a2e')
    clock_label.pack(pady=(0, 20))
    
    # Meeting title
    summary = event.get('summary', 'Untitled Meeting')
    title_label = tk.Label(
        main_frame, 
        text=summary,
        font=title_font,
        fg='#ffffff',
        bg='#1a1a2e',
        wraplength=screen_width - 200
    )
    title_label.pack(pady=(0, 30))
    
    # Start time
    start = event.get('start', {})
    start_time = start.get('dateTime', start.get('date', ''))
    if start_time:
        try:
            dt = date_parser.parse(start_time)
            time_str = dt.strftime('%H:%M')
            time_label = tk.Label(
                main_frame,
                text=f"Starting at {time_str}",
                font=time_font,
                fg='#e94560',
                bg='#1a1a2e'
            )
            time_label.pack(pady=(0, 50))
        except:
            pass
    
    # Buttons frame
    button_frame = tk.Frame(main_frame, bg='#1a1a2e')
    button_frame.pack(pady=20)
    
    # Join button (if meeting link exists)
    if meeting_link:
        join_btn = tk.Button(
            button_frame,
            text="🎥 Join Meeting",
            font=button_font,
            bg='#0f3460',
            fg='white',
            activebackground='#16213e',
            activeforeground='white',
            padx=40,
            pady=20,
            relief='flat',
            command=join_meeting
        )
        join_btn.pack(side='left', padx=20)
    
    # Snooze button
    snooze_btn = tk.Button(
        button_frame,
        text="⏸️ Snooze 2min",
        font=button_font,
        bg='#533483',
        fg='white',
        activebackground='#3d2661',
        activeforeground='white',
        padx=40,
        pady=20,
        relief='flat',
        command=lambda: snooze(2)
    )
    snooze_btn.pack(side='left', padx=20)
    
    # Dismiss button
    dismiss_btn = tk.Button(
        button_frame,
        text="✓ Dismiss",
        font=button_font,
        bg='#e94560',
        fg='white',
        activebackground='#c73e54',
        activeforeground='white',
        padx=40,
        pady=20,
        relief='flat',
        command=dismiss
    )
    dismiss_btn.pack(side='left', padx=20)
    
    # Keyboard shortcuts
    root.bind('<Escape>', lambda e: dismiss())
    root.bind('<Return>', lambda e: join_meeting() if meeting_link else dismiss())
    root.bind('<space>', lambda e: snooze(2))
    
    # Auto-dismiss after timeout
    root.after(ALERT_DURATION_SECONDS * 1000, dismiss)
    
    # Play alert sound
    subprocess.run(['afplay', '/System/Library/Sounds/Glass.aiff'], capture_output=True)
    
    root.mainloop()


def main():
    """Main loop - check for upcoming meetings and show alerts."""
    print("🚀 Meeting Reminder started!")
    print(f"   Checking every {CHECK_INTERVAL_SECONDS} seconds")
    print(f"   Alerting {REMINDER_MINUTES_BEFORE} minutes before meetings")
    print("   Press Ctrl+C to stop\n")
    
    try:
        service = get_calendar_service()
        print("✅ Connected to Google Calendar\n")
    except Exception as e:
        print(f"❌ Failed to connect: {e}")
        sys.exit(1)
    
    alerted_events = set()  # Track events we've already alerted for
    
    while True:
        try:
            # Check for events starting in the next REMINDER_MINUTES_BEFORE minutes
            events = get_upcoming_events(service, minutes_ahead=REMINDER_MINUTES_BEFORE + 1)
            
            now = datetime.now()
            
            for event in events:
                event_id = event['id']
                
                # Skip if already alerted
                if event_id in alerted_events:
                    continue
                
                # Skip all-day events
                start = event.get('start', {})
                if 'date' in start and 'dateTime' not in start:
                    continue
                
                # Parse start time
                start_time_str = start.get('dateTime', '')
                if not start_time_str:
                    continue
                
                start_time = date_parser.parse(start_time_str)
                
                # Make timezone-aware comparison
                if start_time.tzinfo:
                    now = datetime.now(start_time.tzinfo)
                
                # Calculate minutes until start
                minutes_until = (start_time - now).total_seconds() / 60
                
                # If event starts within our reminder window
                if 0 <= minutes_until <= REMINDER_MINUTES_BEFORE:
                    summary = event.get('summary', 'Untitled Meeting')
                    meeting_link = extract_meeting_link(event)
                    
                    print(f"⏰ ALERT: {summary} starts in {int(minutes_until)} minutes!")
                    
                    # Mark as alerted
                    alerted_events.add(event_id)
                    
                    # Show full-screen alert in a separate thread
                    threading.Thread(
                        target=show_fullscreen_alert,
                        args=(event, meeting_link),
                        daemon=True
                    ).start()
            
            # Clean up old alerted events (keep only last 50)
            if len(alerted_events) > 50:
                alerted_events.clear()
            
        except Exception as e:
            print(f"⚠️ Error checking calendar: {e}")
        
        time.sleep(CHECK_INTERVAL_SECONDS)


if __name__ == '__main__':
    main()
