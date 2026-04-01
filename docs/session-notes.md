concerns:
- I don't want to include specific file paths. I think it would be better if the user, when they trigger this skill, is just expected to grab everything they require. Perhaps the agent is also told generally what each step needs. For example, component inventory should use the frontend spec and ShadCN skill, while the setup should use the design doc and relevant sections of the frontend spec.
- The language of this response sometimes seems to suggest referencing specific files and specific sections. For example, it mentions reading docs/frontend-design-doc.md in sections 8 and 10 of the specific spec. Obviously, because this is a skill, it will not actually include these explicit mentions.
- new order: setup -> build order -> ShadCN install -> iterate and build
- no formal plan doc
- session break after ShadCN install so fresh context for building, ensure neccessary context is transferred (ShadCN skill + setup)
- "Before writing component JSX, read .claude/skills/shadcn/rules/styling.md and
  .claude/skills/shadcn/rules/composition.md."
- consider adding in the ShadCN skill / Claude file to force agent to explore ShadCM skill extra files more
- no need to include 