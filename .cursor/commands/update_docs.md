# Update Docs

Run this command at the end of a work session to keep all project documentation current.

---

## 1. Update project.md (Session Log)

Run the update script to append a timestamped entry to `project.md` with the latest git commit and a status summary:

```bash
python scripts/update_project.py "Brief summary of what you worked on this session"
```

If running interactively (no argument), the script will prompt for the status update.

---

## 2. Update README.md (If Applicable)

If the project structure, setup steps, or high-level overview has changed this session, update `README.md` to reflect it.

Things to check:
- Does the **File Structure** section still match the actual layout?
- Does **Quick Start** reflect any new setup steps?
- Does **How it Works** accurately describe the current architecture?

Wayne_Bot-specific sections to keep current:
- The list of active features/capabilities (memory, RAG, integrations, etc.)
- Any new CLI commands or environment variables introduced

---

## 3. Update Other Living Documents (If Applicable)

<!-- Memory & RAG Schema
If you modified how memory is stored or retrieved:
- File: `docs/memory_schema.md` (create if it doesn't exist)
- What to update: memory types, storage format, retrieval strategy
-->

<!-- Agent / Tool Registry
If you added or changed a subagent or tool:
- File: `docs/agents.md` (create if it doesn't exist)
- What to update: agent name, purpose, inputs/outputs, trigger conditions
-->

<!-- Obsidian Integration
If you changed how vault exploration or quizzing works:
- File: `docs/obsidian_integration.md` (create if it doesn't exist)
- What to update: vault paths, indexing approach, quiz format
-->

<!-- Environment Variables
If you added new environment variables, add them to:
- `.env.example` (with a blank or placeholder value)
- Document what the var does in the relevant doc or README
-->

---

## 4. Commit the Doc Updates

After all docs are updated, commit the changes:

```bash
git add project.md README.md  # add whichever docs you updated
git commit -m "docs: update project log and docs for session [DATE]"
```
