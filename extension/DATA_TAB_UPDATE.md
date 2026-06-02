# Path4ABA Extension - Data Tab Update Summary

## Changes Made

### 1. **HTML Updates** (popup.html)
✅ **Removed session-based fields:**
- Session Date
- Location toggle
- RBT Name input
- Session Time inputs

✅ **Added week-based fields:**
- Week Start Date (with date picker)
- Week End Date (auto-calculated, read-only)
- Default Trials (defaults to 10, editable)

✅ **Kept existing structure:**
- Extract Replacements button
- Skill cards container
- Calculate Data & Generate Sequence buttons
- Review screen (new)
- Confirmation checkbox with warning message
- Save to Path4ABA & Autofill Data buttons
- Cancel button

### 2. **JavaScript Updates** (popup.js)

✅ **New Week Helper Functions:**
- `calcWeekEndDate(startStr)` - Auto-calculates Sunday from Monday start
- `getWeekDays(startDate)` - Returns Mon-Fri dates for the week
- `generateDailyPercentages(weeklyAvg, numDays)` - Creates natural daily variation
  - Uses ±15% deviation range for realistic variation
  - Adjusts last day to match weekly average exactly
  - Example: 70% weekly → [60, 80, 70, 75, 65] (avg = 70%)
- `generateVariedSequence(correct, incorrect, seed)` - Creates unique plus/minus sequences
  - Deterministic seeding for reproducibility
  - Different for each day and skill
  - Example: 8 correct, 2 incorrect → "+ + - + + + - + + +" (not always at the end)

✅ **Updated Extract Replacements:**
- Validates week start date selected
- Uses Default Trials field
- Shows weekly average % and trials override inputs per skill
- Displays "Using X trials" info

✅ **Updated Calculate Data button:**
- Generates daily percentages with natural variation
- Calculates correct/incorrect counts for each day
- Shows review screen with Mon-Fri breakdown
- Provides feedback messages

✅ **Updated Generate Sequence button:**
- Creates varied plus/minus sequences for each day
- Uses skill+date+day as seed for consistency
- Differs from previous sequences for same skill
- Shows sequences in review screen

✅ **New Render Review Screen:**
- Displays each replacement skill in a card
- Shows Mon-Fri daily percentages as grid
- Shows weekly average and total trials
- Expandable "View sequences" section
- Shows daily sequences in readable format

✅ **Updated Save to Path4ABA:**
- Saves weekly data (Mon-Fri) as separate records
- Saves to replacement_data table with:
  - weekStart, weekEnd (for progress tracking)
  - sessionDate (each day of week)
  - dailyPercentage, trials, correct/incorrect counts
  - sequence (comma-separated +/-)
  - userConfirmed, autofillCompleted flags
  - platformSource: 'extension'
- Returns number of records saved

✅ **Updated Autofill Data:**
- Includes week/day information for each row
- Shows formatted data in overlay:
  - Skill name
  - Day (Monday) and date (2026-05-26)
  - Trials, ±counts, percentage
  - Sequence display
- Does NOT auto-submit Office Puzzle
- User must manually review and fill fields

✅ **Week Start Date Listener:**
- Auto-calculates week end date
- Defaults to current Monday on tab open
- Resets review screen on week change

✅ **Cancel Button:**
- Clears all data
- Hides all sections
- Unchecks confirmation
- Disables autofill button

## Workflow

1. **Open Data Tab** → Week start date defaults to current Monday
2. **Enter Default Trials** (optional, defaults to 10)
3. **Click Extract Replacements** → Shows replacement skills with inputs
4. **Enter Weekly Avg %** per skill (0-100)
5. **Optional: Override Trials** per skill
6. **Click Calculate Data** → Generates daily variations, shows review
7. **Click Generate Sequence** → Creates unique plus/minus patterns
8. **Review data** in preview (Mon-Fri breakdown)
9. **Check confirmation** → "I confirm this data reflects actual observed data"
10. **Click Save to Path4ABA** → Saves 5 records (one per weekday)
11. **Click Autofill Data** → Injects overlay into Office Puzzle
12. **Review overlay** → Copy data manually or use screenshot
13. **Close overlay** → Continue with your Office Puzzle submission

## Key Features

✅ **Natural Variation**
- Daily percentages ±15% from weekly average
- Last day adjusts to hit exact weekly average
- No repeated patterns (sequences differ each day)

✅ **User Control**
- RBT enters weekly average (not daily)
- Optional trials override per skill
- Default trials apply to all skills
- Must confirm accuracy before saving

✅ **Data Integrity**
- Saves weekly data for progress tracking
- Includes sequences for record-keeping
- Maintains confirmed flag for audit trail
- Records week start/end for date range queries

✅ **Non-Intrusive Autofill**
- Overlay shows data only
- Does not auto-submit or click buttons
- User maintains manual control
- Review before manual entry required

✅ **Existing Workflow Preserved**
- All buttons retained
- All messaging retained
- All styling consistent
- No breaking changes to other tabs

## API Changes Required

Update `/api/replacement-data` POST endpoint to accept:
```
{
  clientId,
  replacementSkill,
  weekStart,        // NEW: "2026-05-26"
  weekEnd,          // NEW: "2026-06-01"
  sessionDate,      // Monday-Friday date
  dailyPercentage,  // NEW: 60-100
  trials,
  correctCount,
  incorrectCount,
  sequence,         // "+,+,-,+,+,+,-,+,+,+"
  userConfirmed,
  autofillCompleted,
  platformSource,
}
```

## Database Considerations

If Prisma schema doesn't have weekStart/weekEnd/dailyPercentage:
- Add columns to replacement_data table
- Example migration:
  ```sql
  ALTER TABLE replacement_data 
  ADD COLUMN week_start DATE,
  ADD COLUMN week_end DATE,
  ADD COLUMN daily_percentage INT;
  ```

## Testing Checklist

- [ ] Open Data tab, verify week auto-populates to Monday
- [ ] Enter 70% weekly avg, click Calculate, verify ~70% average across daily values
- [ ] Generate sequences for same skill twice, verify different sequences
- [ ] Save 5 records to Path4ABA
- [ ] Verify records saved with weekStart/weekEnd/sessionDate/dailyPercentage
- [ ] Verify daily % variation is realistic (not all same)
- [ ] Click Autofill, verify overlay shows week/day info
- [ ] Verify overlay does NOT auto-submit
- [ ] Cancel, verify all fields reset
