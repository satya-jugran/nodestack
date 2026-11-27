# Qortexa Memory

Use the `qortexa` MCP server with `qortexaId: "nodestack"` for persistent project memory in this workspace.

## Workflow
- **Start of task:** Call `qortexa_recall` with `qortexaId: "nodestack"` to retrieve relevant prior decisions, patterns, and context.
- **During work:** Use `qortexa_learn` to record reusable insights, conventions, or gotchas, and `qortexa_decide` for architectural/design decisions.
- **End of significant work:** Call `qortexa_checkpoint` with `qortexaId: "nodestack"` to save a session checkpoint.
