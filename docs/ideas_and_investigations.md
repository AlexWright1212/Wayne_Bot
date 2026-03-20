# Ideas & Investigations

Parking lot for things worth exploring. Not commitments — just things to not forget.

---

## Tool & Ecosystem Exploration

- **Claude Official Plugins (Marketplace):** Installed at `~/.claude/plugins/marketplaces/claude-plugins-official/` but never explored. Includes skill-creator, feature-dev, code-review, hookify, plugin-dev, claude-code-setup, pr-review-toolkit, and more. Worth auditing for useful additions to workflow.
- **Skill Creator plugin:** Especially interesting — a skill that helps build other skills correctly. Could solve the "I want to make skills but want to make them right" problem.

## Skill & Workflow Fixes

- **test-philosophy:** Currently an invocable skill (`disable-model-invocation: true`). Should be converted to an always-loaded reference (e.g., project CLAUDE.md inclusion, or a skill without `disable-model-invocation`) so the model sees it automatically during implementation.
- **Deprecated skill cleanup:** `sub-plans` and `validate-sub-plan` still on disk at `~/.claude/skills/`. Can be removed or archived when convenient.

## Workflow Gaps to Address

- **Research integration:** No structured way to research libraries, APIs, MCP servers, skills, or patterns from within Claude Code. Currently done ad-hoc via Gemini/Perplexity, disconnected from codebase context.
- **Session handoff documents:** Want a pattern for producing a handoff doc at end of a session so the next conversation can pick up cleanly. Saw someone doing this — worth researching concrete approaches.
- **Context management:** Managing complexity across multiple Claude Code tabs and sessions is hard. Too many things in flight, easy to lose track.
- **Frontend workflow:** Still figuring out the right agentic approach for frontend development. ShadCN + registries are set up but the workflow isn't smooth yet.

## Things to Build / Skills to Create

- (placeholder — add specific skill ideas here as they come up)
