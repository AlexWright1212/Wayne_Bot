# Claude Code Instructions

## Rules, Formatting & Constraints

For all formatting requirements, coding constraints, environment notes, and versioning rules, you **MUST** read the files in `.cursor/rules/` before proceeding with any task:

- `.cursor/rules/agent.mdc` — Project context, SDD workflow, and agent guidelines
- `.cursor/rules/constraints.mdc` — Environment constraints and command syntax rules
- `.cursor/rules/versioning.mdc` — Git workflow and branching rules

These files are the source of truth. Do not assume defaults — always read them first.

## Spec-Driven Development

This project follows **Spec-Driven Development (SDD)**. The files in `spec/` define what success looks like. The orchestration files in `.cursor/commands/` explain how to work toward that spec.

- Read `spec/` before writing any code.
- Read `.cursor/commands/overlord_guide.md` to understand the intended workflow.
- Never edit spec or overlord files without explicit user approval.

## Session Logging

At the **end of every work session**, run the Cursor command:

```
.cursor/commands/update_docs.md
```

This command orchestrates all end-of-session doc updates. At minimum it will run:

```bash
python scripts/update_project.py
```

Which appends the current UTC timestamp, the latest git commit, and a status summary to `project.md`. The `update_docs.md` command also contains placeholders for any other living documents that need to stay current (README, schema docs, API references, etc.).
