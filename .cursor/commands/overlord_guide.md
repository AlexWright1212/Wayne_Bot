# Overlord: Agent Orchestration Guide

> **How to use this file:**
> This is a guide for writing your own overlord/orchestration document. Replace every
> `[YOUR PROJECT: ...]` block with specifics for your project. Delete this instructions block
> when done. See `overlord_example.md` for a completed reference example.

---

## What This Document Does

[YOUR PROJECT: In 2-4 sentences, explain what autonomous task this overlord instructs the agent
to perform. What is the agent optimizing, iterating on, or building?]

---

## Your Job

**Goal:** [YOUR PROJECT: State the single measurable goal the agent is working toward.
Be specific — e.g., "achieve 0 unmatched groups", "pass all test cases", "reduce error rate below 1%".]

**Reference:** See `spec/` for complete requirements, priorities, and success criteria.

---

## How to Test Your Changes

### The Evaluator: [YOUR PROJECT: Name your test/evaluation script]

**What it does:**
- [YOUR PROJECT: Describe what the script measures]
- [YOUR PROJECT: Describe what inputs it uses]
- [YOUR PROJECT: Describe what outputs it produces]

**How to use:**
```bash
[YOUR PROJECT: Insert the command to run your evaluation]
```

**Parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| [param]   | Yes/No   | -       | [description] |

---

## How to Read Past Results

[YOUR PROJECT: Describe where results are logged and what to look for.
Where does the agent check to understand history and avoid repeating mistakes?]

- `[log file]` — [what it contains and when to use it]
- `[results folder]` — [what it contains and when to use it]

---

## Git Workflow

### The Complete Cycle

1. **Make changes** (edit your source files)
2. **Run evaluation** (using your test script)
3. **Review results** (check your log files)
4. **Update analysis** (document what you learned)
5. **Decide:** Improvement → commit and tag. Regression → don't commit.

### Git Commands

```bash
git add -A
git commit -m "Exp XX: Brief description of what changed"
git tag exp_XX
```

---

## Agent Workflow

### Complete Cycle

**1. Make Changes**
[YOUR PROJECT: What files does the agent typically edit?]

**2. Run Evaluation**
```bash
[YOUR PROJECT: Exact command]
```

**3. Review Results**
[YOUR PROJECT: What does the agent look at to judge success?]

**4. Update Analysis Log**
[YOUR PROJECT: Where does the agent document its findings?]

**5. Make Decision**
- **Improvement:** [YOUR PROJECT: Define what counts as improvement] → Commit and tag
- **Regression:** [YOUR PROJECT: Define what counts as regression] → Don't commit, try different approach

---

## Quick Reference

**Key Files:**
- `spec/` — Success criteria and requirements
- `[YOUR PROJECT: your evaluator script]` — Run experiments
- `[YOUR PROJECT: your log file]` — Auto-generated summaries
- `[YOUR PROJECT: your analysis file]` — Manual learning log

**Workflow:**
Code → Run → Review → Analyze → Decide (commit or not) → Continue

**Goal:**
[YOUR PROJECT: Restate the measurable goal in one line]

---
