#!/bin/bash
# Cleanup completed and past reminders from the Calendar list

echo "🧹 Cleaning up Calendar reminders..."

osascript <<'ENDSCRIPT'
tell application "Reminders"
    if not (exists list "Calendar") then
        return "No Calendar list found"
    end if
    
    set myList to list "Calendar"
    set deletedCount to 0
    set now to current date
    
    -- Get all reminders
    set allReminders to reminders of myList
    set remindersToDelete to {}
    
    repeat with r in allReminders
        set shouldDelete to false
        
        -- Check if completed
        if completed of r then
            set shouldDelete to true
        end if
        
        -- Check if remind date is in the past (and not completed yet)
        try
            set remindDate to remind me date of r
            if remindDate < now then
                set shouldDelete to true
            end if
        end try
        
        if shouldDelete then
            set end of remindersToDelete to r
        end if
    end repeat
    
    -- Delete the reminders
    repeat with r in remindersToDelete
        delete r
        set deletedCount to deletedCount + 1
    end repeat
    
    return "Deleted " & deletedCount & " reminders (completed or past)"
end tell
ENDSCRIPT

echo "✅ Done!"
