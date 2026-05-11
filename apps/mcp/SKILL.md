---
name: mycelium-mcp
description: Use when an agent needs to work with the Mycelium MCP knowledge base to search, read, create, update, organize, or save notes and memories. Includes directory-aware workflows, the memories directory rule for save_memory, and templates for reports, plans, decisions, research, and meeting notes.
---

# Mycelium MCP

Mycelium is a persistent knowledge base for agents and humans. Use it to preserve durable knowledge as notes, connect related notes with wikilinks, and organize notes into nested directories.

## Tool Map

Read tools require `agent:read`:

- `search_notes`: full-text search by query, optional `tag`, `status`, `limit`.
- `list_notes`: paginated notes. Default is all non-archived notes, sorted pinned first then `updatedAt` descending. Supports `status`, `tag`, `query`, `directoryId`, `unfiled`, `cursor`, `limit`.
- `read_note`: full note by `slug`, `format: "json"` or `"markdown"`.
- `list_tags`: all tags with non-archived note counts.
- `list_directories`: nested directory tree with direct non-archived note counts.
- `get_backlinks`, `get_outgoing_links`, `get_graph`: link and graph exploration.
- `get_context`: session-start context by topic or recent notes.
- `get_session_context`, `list_session_context`: ephemeral connection context.

Write tools require `notes:write`:

- `create_note`: create note with `title`, `content`, optional `status`, `tags`, `directoryId`.
- `update_note`: update note by `slug`; supports `title`, `content`, `status`, `tags`, `directoryId`, `message`.
- `create_directory`: create root or nested directory with `name`, optional `parentId`.
- `update_directory`: rename or move directory with `id`, optional `name`, `parentId`; cycles are rejected.
- `delete_directory`: delete only empty directories.
- `save_memory`: create a published durable memory note tagged `agent-memory`.
- `set_session_context`: store ephemeral per-session key/value context.

## Operating Rules

Search before creating. Prefer `search_notes` or `list_notes` to avoid duplicate notes, then `read_note` before updating.

Preserve user content. When updating, keep existing structure, wikilinks, tags, and directory unless the task requires changing them. Use `message` on meaningful content updates.

Use wikilinks for durable relationships: `[[Related Note Title]]`. The save pipeline extracts and reconciles links.

Use session context for temporary state only. Use `set_session_context` for connection-local scratch information and `save_memory` for durable facts that should survive future sessions.

## Directory Workflow

Directories are first-class organization. A note belongs to zero or one directory.

1. Call `list_directories` before filing notes.
2. Reuse an existing directory when the name and parent match the intent.
3. Use `create_directory` for missing directories. Use `parentId` for nested directories.
4. Pass `directoryId` to `create_note` for new filed notes.
5. Pass `directoryId` to `update_note` to move a note.
6. Pass `directoryId: null` to `update_note` to move a note to Unfiled.
7. Use `list_notes({ directoryId })` for notes directly in a directory.
8. Use `list_notes({ unfiled: true })` for notes without a directory.

Do not delete directories unless they are empty. If `delete_directory` reports `Directory is not empty`, list or move contained notes and child directories first.

## Memory Rule

Always use `save_memory` for agent memories. `save_memory` automatically stores memory notes in the root `memories` directory, creating that directory if missing, and adds the `agent-memory` tag.

Use concise memory titles that will search well later:

- `Project X API Auth Decision`
- `Mycelium MCP Directory Behavior`
- `Customer Y Deployment Constraint`

Memory content should include the fact, why it matters, source/context, and date if time-sensitive.

## Common Workflows

Load context:

1. `get_context({ topic })`
2. `search_notes({ query })` if more precision is needed
3. `read_note({ slug })` for full content
4. Use backlinks/outgoing links when relationships matter

Create a filed note:

1. `list_directories`
2. `create_directory` if needed
3. `create_note({ title, content, status: "PUBLISHED", tags, directoryId })`

Update a note:

1. `read_note({ slug, format: "json" })`
2. Modify only the relevant fields
3. `update_note({ slug, content, tags, directoryId, message })`

Save durable memory:

1. Search for an existing memory when likely duplicate
2. `save_memory({ title, content, tags })`

## Templates

Use these templates as note content. Keep sections that matter; delete sections that do not.

### Report

```markdown
# <Report Title>

## Summary
<One paragraph with the result and why it matters.>

## Findings
- <Finding 1>
- <Finding 2>

## Evidence
- <Source, note, log, or observation>
- <Source, note, log, or observation>

## Risks
- <Risk and impact>

## Recommendations
- <Actionable recommendation>

## Next Actions
- [ ] <Owner/action/date if known>
```

### Plan

```markdown
# <Plan Title>

## Objective
<Desired outcome.>

## Assumptions
- <Assumption>

## Constraints
- <Constraint>

## Steps
1. <Step>
2. <Step>
3. <Step>

## Verification
- <How success will be checked>

## Rollback
- <How to undo or recover>

## Open Questions
- <Question>
```

### Decision

```markdown
# <Decision Title>

## Context
<What prompted the decision.>

## Decision
<The chosen option.>

## Options Considered
- <Option>: <tradeoff>
- <Option>: <tradeoff>

## Rationale
<Why this option won.>

## Consequences
- <Expected impact>

## Review
<When or what condition should trigger revisiting this.>
```

### Research

```markdown
# <Research Topic>

## Question
<What needs to be answered.>

## Short Answer
<Current best answer.>

## Notes
- <Observation>
- <Observation>

## Sources
- <Source or related note>

## Confidence
<High / medium / low, with reason.>

## Follow-Ups
- <Follow-up question or task>
```

### Meeting

```markdown
# <Meeting Title>

## Attendees
- <Name>

## Topics
- <Topic>

## Decisions
- <Decision>

## Action Items
- [ ] <Owner/action/date if known>

## Notes
- <Note>
```

## Quality Bar

Prefer fewer, better notes. Titles should be stable and searchable. Content should be useful to an agent that has no conversation history. Put durable knowledge in notes, not session context. Put agent memories in the `memories` directory through `save_memory`.
