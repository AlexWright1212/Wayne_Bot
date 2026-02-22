# BSC Case Competition Scheduler - Specification

## Executive Summary

The **BSC Case Competition Scheduler** is a web-based automation tool designed to solve the complex logistics of matching Business Student Council (BSC) members with High School student teams for mentorship sessions.

Each year, the case competition brings together dozens of high school entrepreneurship groups with college mentors. Finding meeting times that work for everyone has traditionally been a manual, time-consuming process involving spreadsheets and countless coordination emails. This system automates that entire process, generating complete schedules in seconds.

**Who Is This For?**

This tool is designed for **BSC organizers and coordinators** who manage the case competition logistics. Users do not need technical expertise—the entire process works through a simple web interface with drag-and-drop file uploads.

**The Core Challenge**

Given the availability of 35-45 high school groups and 60-80 BSC mentors, match them such that everyone is scheduled for mentorship in compatible time slots. The system prioritizes:
1. Every high school group receives exactly one mentorship session
2. Every BSC member is assigned to exactly one group
3. All meeting times are verified to have genuine 30-minute overlaps with no conflicts

---

## The Problem We're Solving

### Before This System:
1. Collect availability from teachers and BSC members in separate Google Forms
2. Export both to spreadsheets
3. Manually compare schedules across 40+ groups and 70+ mentors
4. Try to find overlapping time slots while balancing group sizes
5. Deal with edge cases: some groups are nearly impossible to match
6. Spend hours coordinating, often with incomplete results

### After This System:
1. Upload two CSV files
2. Click "Generate Schedules"
3. Review 15 ranked options showing different possible matches
4. Select the best schedule
5. Download a complete roster with assigned mentors and specific meeting times

---

## How It Works: The User Flow

### Step 1: Collect Availability Data

**Two Google Forms** collect availability:

**Form 1: Teacher/High School Group Availability**
- Teacher name and contact info
- Student names and business idea
- Which days they're available (Mon-Fri checkboxes)
- Up to two time windows per day (e.g., "10:00 AM - 11:30 AM" and "1:00 PM - 3:00 PM")

**Form 2: BSC Member Availability**
- Member name and contact info
- Specific availability for each day of the week
- Up to two time blocks per day

**Important Context:**
- All availability is valid for the same two consecutive weeks
- All mentorship sessions are exactly **30 minutes**
- Each high school group needs exactly **one** meeting during the competition cycle

### Step 2: Export and Upload CSVs

Export both Google Forms to CSV files (standard Google Sheets export). Then:

1. Open the BSC Scheduler web app
2. Drag and drop (or click to browse) the **Teacher CSV file**
3. Drag and drop (or click to browse) the **BSC Member CSV file**
4. System validates file structure and displays confirmation

If there are formatting issues (missing columns, corrupted data), the system will display a clear error message.

### Step 3: Generate Schedules

Click the **"Generate Schedules"** button.

**What happens behind the scenes:**
- The system runs multiple randomized scheduling simulations (takes 5-60+ seconds depending on simulation count)
- Each simulation uses a different randomized approach to matching
- Results are scored based on quality metrics with strict priority hierarchy:
  - **CRITICAL #1 (Highest Priority):** Every high school group must have ≥1 BSC mentor
  - **CRITICAL #2 (Highest Priority):** Every BSC member must be assigned to exactly one group
  - **Important:** Maximize teams of 2 BSC members (ideal mentorship size)
  - **Acceptable:** Allow teams of 1, 3, 4, or larger if needed to ensure full coverage (Goals #1 and #2)
  - **Note:** Unbalanced team sizes (one group of 7 while others have 2) are acceptable if everyone is matched

**The Scarcity Algorithm:**
Groups with very limited availability (few possible matches) are prioritized first to ensure they don't get left out.

### Step 4: Review Options

Instead of showing just one "best" result, the system presents a **ranked table of the top 15 schedules**, giving you options to choose from.

**Summary Table Columns:**
- **Schedule ID** - Numbered ranking (#1, #2, #3, etc.)
- **Fitness Score** - Internal quality metric (higher = better)
- **Unmatched HS Groups** - Should always be 0 (or the schedule failed)
- **Unassigned BSC Members** - Should always be 0 (or the schedule failed)
- **Teams of 1** - Count of solo mentors (discouraged but sometimes necessary)
- **Teams of 2** - Count of paired mentors (ideal)
- **Teams of 3** - Count of three-person mentor teams (acceptable)
- **Teams of 4+** - Count of larger teams (avoided when possible)

**Why Multiple Options?**
Different schedules might excel in different ways:
- Schedule #1 might have the most pairs but assign certain mentors you'd prefer to separate
- Schedule #2 might better distribute specific people across groups
- Schedule #3 might assign compatible mentors to challenging groups

You have the flexibility to choose based on factors the algorithm can't know (personality fits, mentor experience levels, etc.).

### Step 5: View Detailed Assignments

Click on any row in the summary table, then switch to the **"Selected Schedule Details"** tab to view the full roster.

The interface uses tabs at the top:
- **"Schedule Rankings"** tab - Shows the summary table of top 15 options (full screen)
- **"Selected Schedule Details"** tab - Shows the complete roster for your selected schedule (full screen)

This shows the complete roster for that specific schedule:

| BSC Mentors | Campus | Teacher | Students | Business Idea | Day | Meeting Time |
|-------------|---------|---------|----------|---------------|-----|--------------|
| Alice Johnson, Bob Smith | Rudder HS | Ms. Collins | Michael Franklin | First Aid Backpack | Monday | 12:30 PM - 1:00 PM |
| Carol Lee, David Kim | Bryan HS | Mr. Luna | Nyeli Arita, Aubree Medina | Alterations | Wednesday | 10:15 AM - 10:45 AM |

**Key Details:**
- **BSC Mentors:** The specific members assigned to this group
- **Meeting Time:** A specific 30-minute window that works for the teacher AND all assigned BSC members
- **Day:** The day of the week for the meeting

The system guarantees that every person listed in a row is available during that exact 30-minute slot.

### Step 6: Export the Final Schedule

Once you've selected the schedule you want to use:

1. Click **"Download Schedule #X"** (where X is the schedule number)
2. An Excel file (.xlsx) is generated with the complete roster
3. Distribute to teachers and BSC members

**The Excel file includes:**
- All columns from the detail view
- Contact information for teachers and BSC members
- Formatted for easy printing and distribution

---

## Understanding the Matching Logic

### How Availability Is Interpreted

**For Teachers:**
If a teacher selects:
- Days: Monday, Wednesday, Friday
- Time Block 1: 9:00 AM - 11:00 AM
- Time Block 2: 1:00 PM - 3:00 PM

This means they have **six possible windows:**
- Monday 9:00-11:00 AM
- Monday 1:00-3:00 PM
- Wednesday 9:00-11:00 AM
- Wednesday 1:00-3:00 PM
- Friday 9:00-11:00 AM
- Friday 1:00-3:00 PM

**For BSC Members:**
Each member specifies availability for each individual day with up to two time blocks per day.

### How Matches Are Made

For each high school group, the system:

1. **Identifies the group's time windows** (based on teacher availability)
2. **Breaks each window into 30-minute slots**
   - Example: 1:00 PM - 3:00 PM becomes: [1:00-1:30, 1:30-2:00, 2:00-2:30, 2:30-3:00]
3. **Finds BSC members available during those specific slots**
4. **Assigns BSC members to create a team**
5. **Selects one specific 30-minute slot** where the teacher AND all assigned BSC members are free

**Critical Guarantee:** The outputted meeting time is confirmed to work for everyone assigned to that group.


---

## When Things Go Wrong: Error Handling

### Scenario 1: No Possible Match
**What happened:** A high school group has availability that doesn't overlap with ANY BSC member.

**System response:** 
- The group is flagged as "UNMATCHED: No Compatible Candidates"
- Appears in the detail view with empty mentor assignments
- Fitness score is heavily penalized

**What to do:** Contact the teacher to provide additional availability or manually assign a BSC member who can adjust their schedule.

### Scenario 2: Not Enough BSC Members
**What happened:** There are more high school groups than BSC members, and the algorithm exhausted all options.

**System response:**
- Remaining groups are flagged as "UNMATCHED: Capacity Exhausted"
- The best partial schedules are still shown

**What to do:** Recruit additional BSC mentors or combine some high school groups.

### Scenario 3: Invalid CSV Format
**What happened:** Uploaded CSV is missing required columns or has corrupted data.

**System response:**
- Upload is rejected before generation begins
- Error message specifies what's wrong (e.g., "Missing column: 'Teacher's Name'")

**What to do:** Re-export the CSV from Google Forms or fix the column headers.

---

## Key System Assumptions

### Binding Availability Window
All availability submissions are assumed valid for **two consecutive weeks** at the same recurring times each week.

Example: If a teacher says "Monday 1:00-3:00 PM," they mean:
- Week 1: Monday, [Date], 1:00-3:00 PM
- Week 2: Monday, [Date+7], 1:00-3:00 PM

### One Meeting Per Group
Each high school group receives **exactly one** 30-minute mentorship session during the competition cycle. The system is not designed for recurring weekly meetings.

### One Assignment Per BSC Member
Each BSC member is assigned to **exactly one** high school group. A member cannot mentor multiple groups in the same competition.

### Same-Day Conflicts Are Allowed
Two different high school groups can be scheduled at the same time (e.g., both at Monday 1:00 PM) as long as they have different assigned mentors. The system only prevents a single BSC member from being double-booked.

---


---

## Success Criteria: Defining Good vs Bad Schedules

### Absolute Requirements (Non-Negotiable)

These constraints can **NEVER** be violated under any circumstances:

#### 1. Time Compatibility Is Sacred

**The Requirement:**
Every assignment between a BSC member and a high school group must have a verified 30-minute overlapping time window where:
- The teacher is available
- ALL assigned BSC members are available
- The windows genuinely overlap (not approximated or forced)

**What This Means:**
- Member available Monday 10:00 AM - 12:00 PM
- Group available Monday 1:00 PM - 3:00 PM
- **Result:** NO assignment can be created (times don't overlap)

**What This Does NOT Mean:**
- The system cannot force an assignment by picking any random time slot
- The system cannot ignore availability conflicts for coverage
- The system cannot create assignments where times "almost" match

**If No Compatible Time Exists:**
The group remains unmatched or the member remains unassigned. This is **preferable** to creating an invalid schedule with time conflicts.

#### 2. One Assignment Per BSC Member

Each BSC member can be assigned to **exactly one** high school group. A member cannot mentor multiple groups in the same competition cycle. This is as non-negotiable as time compatibility.

### Upfront Validation: Feasibility Checks

Before running the scheduling algorithm, perform these checks:

1. **For each high school group:** Does at least one BSC member have overlapping availability?
   - If NO: Flag this group as "impossible to match" and adjust expectations
   
2. **For each BSC member:** Does at least one high school group have overlapping availability?
   - If NO: Flag this member as "impossible to match" and adjust expectations

**Why This Matters:**
If 1 group has no possible matches, you cannot achieve a 0/0 schedule (perfect matching). Instead, the realistic target becomes 1/0 (one unmatched group, zero unassigned members). This distinguishes between:
- System failure: "Our algorithm couldn't find a good match"
- Data reality: "This group's availability genuinely doesn't overlap with any mentor"

**User Notification:**
Flagged impossibilities appear in the schedule details with a note like: "Group X could not be matched - no BSC member has availability during their time window."

### Priority Hierarchy: What Makes a Schedule "Good"

Schedules are ranked by this strict hierarchy. An improvement at a higher priority outweighs any amount of improvement at a lower priority.

#### Priority 1 (PARAMOUNT): Full High School Group Coverage

**Goal:** Every high school group is assigned at least one BSC mentor.

**Notation:** Use X/Y where:
- X = number of unmatched high school groups
- Y = number of unassigned BSC members

**Target:** X = 0 (or the minimum possible given flagged impossibilities)

**Why This Matters:**
- A schedule with 0/5 (all groups covered, 5 mentors unassigned) is infinitely better than 1/0 (one group uncovered, all mentors assigned)
- High school groups are the core users of this system; they cannot proceed without a mentor
- Better to have unassigned mentors than uncovered groups

**Example:**
- Schedule A: 0 unmatched groups, 5 unassigned members, 20 groups of 1
- Schedule B: 1 unmatched group, 0 unassigned members, 3 groups of 1
- **Winner:** Schedule A (0/5 > 1/0, despite worse group sizes)

---

#### Priority 2 (CRITICAL): Full BSC Member Utilization

**Goal:** Every BSC member is assigned to exactly one group.

**Target:** Y = 0 (or realistically Y ≤ 2 if very difficult)

**Why This Matters:**
Once all high school groups are covered (Priority 1), the next goal is to get every mentor assigned. A mentor sitting on the sidelines is a wasted resource.

**The Final Pass Algorithm:**
When you reach a state like 0/3 (all groups covered, few mentors left unassigned):
1. Check if this member has any compatible group (already verified in upfront validation)
2. If YES: Place them in the best available group, even if it creates a group of 5, 6, or 7
3. If NO: Leave them unassigned (they were flagged as impossible during upfront validation)

**Never compromise time compatibility during the final pass.** But if time compatibility exists, placement happens regardless of group size impact.

**Example:**
- Schedule A: 0/2 with 5 groups of 1, 35 groups of 2, 3 groups of 3
- Schedule B: 0/3 with 2 groups of 1, 38 groups of 2, no groups of 3
- **Winner:** Schedule A (0/2 > 0/3, even with worse group size distribution)

---

#### Priority 3 (SECONDARY): Group Size Optimization

**Goal:** Prefer smaller, more balanced mentor teams over larger ones.

**Preferences (in order):**
1. Groups of 2 or 3 are equally ideal
2. Groups of 1 are acceptable (first ~10 are normal, incrementally less preferred beyond that)
3. Groups of 4-6 are acceptable if needed for full coverage
4. Groups of 7+ should be avoided but acceptable if it's the only way to achieve full coverage

**Realistic Expectations:**
- Most runs will have 10-15 groups of 1 (this is normal and expected)
- A schedule with 15 groups of 1 is still very good if it achieves 0/0
- 1-2 groups of 5-6 are completely acceptable if they enable full coverage

**When Priority 3 Should NOT Override Priorities 1 & 2:**
Never sacrifice a 0/0 schedule for better group sizes. A 0/0 schedule with 20 groups of 1 and 1 group of 6 is better than a 0/3 schedule with all groups being 2-3 members.

**Example:**
- Schedule A: 0/0 with 18 groups of 1, 22 groups of 2, 3 groups of 3
- Schedule B: 0/0 with 10 groups of 1, 30 groups of 2, 3 groups of 3
- **Winner:** Both are good outcomes. Schedule B is slightly preferable, but the difference is minimal compared to achieving 0/0.

---

### Comparative Examples: Illustrating the Priority Hierarchy

Use these examples to understand schedule quality:

**Example 1: Unmatched Groups Trump Everything**
- Schedule A: 0/5, includes 20 groups of 1, 1 group of 6
- Schedule B: 1/0, all groups are 2-3 members
- **Winner:** Schedule A (group coverage is paramount)

**Example 2: Unassigned Members Trump Group Sizes**
- Schedule A: 0/2 with 5 groups of 1, 35 groups of 2, 3 groups of 3
- Schedule B: 0/3 with all perfect pair distribution
- **Winner:** Schedule A (getting that second mentor assigned matters more than perfect pairs)

**Example 3: When Coverage Is Equal, Group Size Matters Slightly**
- Schedule A: 0/0 with 8 groups of 1, 30 groups of 2, 5 groups of 3
- Schedule B: 0/0 with 15 groups of 1, 25 groups of 2, 3 groups of 3
- **Winner:** Roughly equal; both are excellent outcomes. Schedule A is slightly preferable but the difference is negligible.

**Example 4: Large Groups Are Fine for Full Coverage**
- Schedule A: 0/0 with 1 group of 6, 2 groups of 5, otherwise groups of 2-3
- Schedule B: 0/3 with all groups being 2-3 members
- **Winner:** Schedule A (0/0 is worth having a few large groups)

---

## Scoring System: Mathematical Implementation

The scheduling algorithm uses a lexicographic scoring system to implement the priority hierarchy. This ensures that schedules are ranked correctly and simulations optimize in the right order.

### Scoring Formula

```
BASE_SCORE = 1000000

// Priority 1: Unmatched Groups (PARAMOUNT)
score -= unmatched_groups * 1000000

// Priority 2: Unassigned Members (CRITICAL but secondary)  
score -= unassigned_members * 100000

// Priority 3: Group Size Optimization (SECONDARY)

// Non-linear penalty for groups of 1
if num_groups_of_1 <= 10:
    // First 10 groups of 1 are free (normal and expected)
    penalty = 0
elif num_groups_of_1 <= 15:
    // Groups 11-15 cost 10 points each (mildly discouraged)
    penalty = (num_groups_of_1 - 10) * 10
else:
    // Groups 16+ cost 20 points each + base penalty (increasingly discouraged)
    penalty = ((num_groups_of_1 - 15) * 20) + 50

score -= penalty

// Teams of 2 and 3 are equally preferred (both get same bonus)
score += teams_of_2 * 50
score += teams_of_3 * 50

// Teams of 4-6 are acceptable (small bonus for using them efficiently)
// Only count up to 5 such groups; beyond that is neutral
score += min(teams_of_4_plus, 5) * 5

// Variance penalty removed (it interferes with final-pass placement)
```

### Why This Formula Works

1. **Lexicographic Ordering:** The 1,000,000 penalty for unmatched groups dwarfs all other factors, ensuring Priority 1 always wins
2. **Gap Between Priorities:** The 10x gap between P1 and P2 (1M vs 100k) ensures a 0/5 beats a 1/0, but the gap is chosen so that achieving 0/0 is strongly preferred when possible
3. **Threshold-Based Group Size Penalty:** The first 10 groups of 1 cost nothing (because they're expected), then incrementally increase, reflecting your preference that 10-15 is normal but 20+ is less ideal
4. **Equal Treatment of 2s and 3s:** Both get the same bonus (50 points), reflecting that they're equally desirable
5. **Final Pass Support:** Removing the variance penalty allows the final pass algorithm to place remaining mentors in large groups without being penalized for it

### Example Score Calculations

**Schedule A: 0/0, 10 groups of 1, 30 groups of 2, 3 groups of 3**
```
score = 1000000
score -= 0 * 1000000 = 1000000  // 0 unmatched groups
score -= 0 * 100000  = 1000000  // 0 unassigned members
score -= 0          = 1000000  // 10 groups of 1 (free)
score += 30 * 50    = 1001500  // 30 groups of 2
score += 3 * 50     = 1001650  // 3 groups of 3
score += min(0, 5) * 5 = 1001650  // No large groups

FINAL SCORE: 1001650
```

**Schedule B: 0/2, 5 groups of 1, 35 groups of 2, 3 groups of 3**
```
score = 1000000
score -= 0 * 1000000 = 1000000  // 0 unmatched groups
score -= 2 * 100000  = 800000   // 2 unassigned members
score -= 0          = 800000  // 5 groups of 1 (free)
score += 35 * 50    = 801750  // 35 groups of 2
score += 3 * 50     = 801900  // 3 groups of 3

FINAL SCORE: 801900
```

**Comparison:** Schedule A (1,001,650) > Schedule B (801,900) ✓ Correct!

The 200,000-point gap from unassigned members dominates any improvement in group size, ensuring Schedule A with perfect matching wins.

---

