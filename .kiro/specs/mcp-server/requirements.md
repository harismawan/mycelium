# Requirements Document

## Introduction

Mycelium MCP Server exposes the Mycelium knowledge base as a Model Context Protocol (MCP) tool server. AI agents such as Claude, Cursor, and Kiro connect to the MCP Server over JSON-RPC (stdio or SSE transport) and invoke tools to search, read, create, update, and navigate notes, tags, and the knowledge graph. The MCP Server reuses the existing Elysia API services and API key authentication system, and can run as a standalone process or alongside the main API.

## Glossary

- **MCP_Server**: The Model Context Protocol server process that exposes Mycelium tools to AI agents over JSON-RPC.
- **MCP_Client**: An AI agent or IDE (Claude Desktop, Cursor, Kiro) that connects to the MCP_Server and invokes tools.
- **Tool**: A callable function registered with the MCP_Server that an MCP_Client can invoke via JSON-RPC.
- **Transport**: The communication channel between MCP_Client and MCP_Server — either stdio (standard input/output) or SSE (Server-Sent Events over HTTP).
- **JSON-RPC**: The wire protocol used by MCP for request/response messaging between client and server.
- **API_Key**: A scoped Bearer token stored in the ApiKey table, used to authenticate MCP_Client requests against the existing Mycelium auth system.
- **Note**: A Markdown document in the Mycelium knowledge base with a title, slug, content, status (DRAFT/PUBLISHED/ARCHIVED), tags, and wikilinks.
- **Wikilink**: A bidirectional link between notes expressed as `[[Note Title]]` in Markdown content.
- **Backlink**: An inbound link from another note that references the current note via a wikilink.
- **Knowledge_Graph**: The directed graph of notes (nodes) and wikilinks (edges) for a user's knowledge base.
- **Discovery_File**: An AGENTS.md or similar file that describes MCP_Server capabilities for automated agent discovery.

## Requirements

### Requirement 1: MCP Server Initialization and Transport

**User Story:** As an AI agent operator, I want to start the MCP Server as a standalone process or alongside the main API, so that AI agents can connect to Mycelium over their preferred transport.

#### Acceptance Criteria

1. WHEN started with the stdio transport flag, THE MCP_Server SHALL accept JSON-RPC messages on standard input and write JSON-RPC responses to standard output.
2. WHEN started with the SSE transport flag, THE MCP_Server SHALL listen on a configurable HTTP port and accept MCP_Client connections via Server-Sent Events.
3. THE MCP_Server SHALL implement the MCP protocol handshake by responding to `initialize` requests with server capabilities including the list of supported tools.
4. THE MCP_Server SHALL respond to `ping` requests from MCP_Clients to confirm the connection is alive.
5. IF the MCP_Server receives a malformed JSON-RPC message, THEN THE MCP_Server SHALL return a JSON-RPC error response with code -32700 (Parse error).
6. IF the MCP_Server receives a request for an unknown method, THEN THE MCP_Server SHALL return a JSON-RPC error response with code -32601 (Method not found).
7. THE MCP_Server SHALL be deployable as a standalone Bun process separate from the main Elysia API server.

### Requirement 2: Authentication

**User Story:** As an AI agent operator, I want the MCP Server to authenticate requests using existing Mycelium API keys, so that agent access is scoped and revocable without a separate credential system.

#### Acceptance Criteria

1. WHEN using stdio transport, THE MCP_Server SHALL read the API key from an environment variable named `MYCELIUM_API_KEY` at startup.
2. WHEN using SSE transport, THE MCP_Server SHALL extract the API key from the `Authorization: Bearer <key>` header on each HTTP connection.
3. THE MCP_Server SHALL validate the API key against the existing ApiKey table using the AuthService.
4. IF the API key is missing or invalid, THEN THE MCP_Server SHALL reject the connection with an authentication error and refuse to execute tools.
5. THE MCP_Server SHALL enforce scope requirements on each tool invocation, requiring at minimum the `agent:read` scope for read operations.
6. WHEN a tool requires write access, THE MCP_Server SHALL require the `notes:write` scope on the API key.
7. IF the API key lacks the required scope for a tool invocation, THEN THE MCP_Server SHALL return a JSON-RPC error indicating insufficient permissions.

### Requirement 3: Search Notes Tool

**User Story:** As an AI agent, I want to search the knowledge base by query text, so that I can find relevant notes without knowing their exact titles or slugs.

#### Acceptance Criteria

1. THE MCP_Server SHALL register a tool named `search_notes` that accepts a required `query` string parameter.
2. THE `search_notes` tool SHALL accept optional `tag`, `status`, and `limit` parameters to filter and paginate results.
3. WHEN invoked, THE `search_notes` tool SHALL execute a full-text search using the existing SearchService against the authenticated user's notes.
4. THE `search_notes` tool SHALL return an array of matching notes, each containing id, slug, title, excerpt, status, and relevance rank.
5. IF the query string is empty, THEN THE `search_notes` tool SHALL return a validation error describing the required parameter.

### Requirement 4: Read Note Tool

**User Story:** As an AI agent, I want to read the full content of a specific note, so that I can use its information for context or reasoning.

#### Acceptance Criteria

1. THE MCP_Server SHALL register a tool named `read_note` that accepts a required `slug` string parameter.
2. WHEN invoked, THE `read_note` tool SHALL retrieve the note using the existing NoteService and return the note's id, slug, title, content (full Markdown body), excerpt, status, tags, and updatedAt timestamp.
3. IF the note with the given slug does not exist, THEN THE `read_note` tool SHALL return an error indicating the note was not found.
4. THE `read_note` tool SHALL accept an optional `format` parameter with values `json` or `markdown`, defaulting to `json`.
5. WHEN the `format` parameter is `markdown`, THE `read_note` tool SHALL return the note as raw Markdown with frontmatter using the existing NoteService markdown export.

### Requirement 5: Create Note Tool

**User Story:** As an AI agent, I want to create new notes in the knowledge base, so that I can capture research findings, summaries, or generated content.

#### Acceptance Criteria

1. THE MCP_Server SHALL register a tool named `create_note` that accepts required `title` and `content` string parameters.
2. THE `create_note` tool SHALL accept optional `status` (DRAFT, PUBLISHED, ARCHIVED) and `tags` (array of strings) parameters.
3. WHEN invoked, THE `create_note` tool SHALL create the note using the existing NoteService, which handles slug generation, excerpt extraction, wikilink reconciliation, and revision creation.
4. THE `create_note` tool SHALL return the created note's id, slug, title, status, and tags.
5. THE `create_note` tool SHALL require the `notes:write` scope on the API key.
6. IF the title is empty, THEN THE `create_note` tool SHALL return a validation error describing the required parameter.

### Requirement 6: Update Note Tool

**User Story:** As an AI agent, I want to update existing notes, so that I can append findings, correct information, or change note status.

#### Acceptance Criteria

1. THE MCP_Server SHALL register a tool named `update_note` that accepts a required `slug` string parameter.
2. THE `update_note` tool SHALL accept optional `title`, `content`, `status`, `tags`, and `message` (revision message) parameters.
3. WHEN invoked, THE `update_note` tool SHALL update the note using the existing NoteService, which handles slug regeneration, wikilink reconciliation, and revision creation.
4. THE `update_note` tool SHALL return the updated note's id, slug, title, status, and tags.
5. THE `update_note` tool SHALL require the `notes:write` scope on the API key.
6. IF the note with the given slug does not exist, THEN THE `update_note` tool SHALL return an error indicating the note was not found.

### Requirement 7: List Tags Tool

**User Story:** As an AI agent, I want to list all tags in the knowledge base, so that I can understand the taxonomy and filter notes by topic.

#### Acceptance Criteria

1. THE MCP_Server SHALL register a tool named `list_tags` that accepts no required parameters.
2. WHEN invoked, THE `list_tags` tool SHALL return all tags associated with the authenticated user's non-archived notes, each containing the tag name and note count.
3. THE `list_tags` tool SHALL return tags sorted alphabetically by name.

### Requirement 8: Get Backlinks Tool

**User Story:** As an AI agent, I want to discover which notes link to a given note, so that I can follow the knowledge graph and understand relationships between concepts.

#### Acceptance Criteria

1. THE MCP_Server SHALL register a tool named `get_backlinks` that accepts a required `slug` string parameter.
2. WHEN invoked, THE `get_backlinks` tool SHALL retrieve the note by slug, then return all notes that link to the target note using the existing LinkService.
3. THE `get_backlinks` tool SHALL return each backlink note's id, slug, title, and tags.
4. IF the note with the given slug does not exist, THEN THE `get_backlinks` tool SHALL return an error indicating the note was not found.

### Requirement 9: Get Outgoing Links Tool

**User Story:** As an AI agent, I want to see which notes a given note links to via wikilinks, so that I can traverse the knowledge graph forward.

#### Acceptance Criteria

1. THE MCP_Server SHALL register a tool named `get_outgoing_links` that accepts a required `slug` string parameter.
2. WHEN invoked, THE `get_outgoing_links` tool SHALL retrieve all outgoing wikilinks from the specified note, returning resolved links (with target note id, slug, and title) and unresolved links (with the target title string).
3. IF the note with the given slug does not exist, THEN THE `get_outgoing_links` tool SHALL return an error indicating the note was not found.

### Requirement 10: Get Knowledge Graph Tool

**User Story:** As an AI agent, I want to retrieve the knowledge graph or a subgraph around a specific note, so that I can understand the overall structure of the knowledge base.

#### Acceptance Criteria

1. THE MCP_Server SHALL register a tool named `get_graph` that accepts no required parameters.
2. THE `get_graph` tool SHALL accept an optional `slug` parameter to retrieve an ego-subgraph centered on a specific note.
3. THE `get_graph` tool SHALL accept an optional `depth` parameter (default 1) controlling how many link hops to traverse from the center note.
4. WHEN invoked without a slug, THE `get_graph` tool SHALL return the full knowledge graph (all non-archived notes as nodes, all resolved links as edges) using the existing LinkService.
5. WHEN invoked with a slug, THE `get_graph` tool SHALL return the ego-subgraph centered on the specified note up to the given depth using the existing LinkService.
6. THE `get_graph` tool SHALL return nodes (id, slug, title, status) and edges (fromId, toId, relation).

### Requirement 11: List Notes Tool

**User Story:** As an AI agent, I want to list notes with optional filters, so that I can browse the knowledge base by status, tag, or text query.

#### Acceptance Criteria

1. THE MCP_Server SHALL register a tool named `list_notes` that accepts no required parameters.
2. THE `list_notes` tool SHALL accept optional `status`, `tag`, `query`, `cursor`, and `limit` parameters.
3. WHEN invoked, THE `list_notes` tool SHALL return a paginated list of notes using the existing NoteService, each containing id, slug, title, excerpt, status, tags, and updatedAt.
4. THE `list_notes` tool SHALL return a `nextCursor` value when more results are available.

### Requirement 12: Agent Discovery File

**User Story:** As an AI agent operator, I want a machine-readable discovery file that describes the MCP Server's capabilities and connection instructions, so that agents can auto-configure their connection to Mycelium.

#### Acceptance Criteria

1. THE MCP_Server project SHALL include an AGENTS.md file at the repository root (or update the existing one) documenting MCP_Server connection instructions, available tools, required authentication, and transport options.
2. THE AGENTS.md file SHALL list each tool by name with a description of its parameters and return values.
3. THE MCP_Server SHALL include an `mcp.json` configuration file that MCP_Clients can use to auto-configure the server connection, specifying the command, arguments, and environment variable requirements.

### Requirement 13: Error Handling and Resilience

**User Story:** As an AI agent operator, I want the MCP Server to handle errors gracefully and return structured error information, so that agents can recover or report failures clearly.

#### Acceptance Criteria

1. IF a tool invocation encounters a database error, THEN THE MCP_Server SHALL return a JSON-RPC error with a descriptive message and the `isRetryable` flag set to true.
2. IF a tool invocation encounters a validation error (missing or invalid parameters), THEN THE MCP_Server SHALL return a JSON-RPC error with code -32602 (Invalid params) and a message describing the validation failure.
3. IF the database connection is unavailable at startup, THEN THE MCP_Server SHALL log the error and exit with a non-zero exit code.
4. THE MCP_Server SHALL log each tool invocation (tool name, duration, success/failure) using structured JSON logging consistent with the existing API logger.

### Requirement 14: OpenClaw Agent Integration

**User Story:** As an OpenClaw agent operator, I want Mycelium to work as a persistent knowledge store for OpenClaw agents, so that agents can read, write, and search notes as part of their memory-wiki workflow.

#### Acceptance Criteria

1. THE MCP_Server SHALL be installable as an OpenClaw skill by providing a `skill.json` manifest file in the `apps/mcp/` directory that declares the server's name, description, MCP transport configuration, and required environment variables.
2. THE MCP_Server SHALL support OpenClaw's memory-wiki read-write loop pattern: agents read context at session start via `list_notes` or `search_notes`, perform work, then write findings back via `create_note` or `update_note` before session end.
3. THE MCP_Server SHALL provide a `get_context` convenience tool that accepts an optional `topic` string and returns the most relevant notes (up to 10) for the given topic using full-text search, or the most recently updated notes if no topic is provided — optimized for OpenClaw's context-loading pattern.
4. THE MCP_Server SHALL provide a `save_memory` convenience tool that accepts required `title` and `content` parameters and optional `tags`, creates a note with status PUBLISHED and tags including `agent-memory`, and returns the created note's slug — optimized for OpenClaw's memory-filing pattern.
5. THE `get_context` and `save_memory` tools SHALL require the `agent:read` and `notes:write` scopes respectively, consistent with the existing scope model.
6. THE `skill.json` manifest SHALL include a `clawHub` section with category `knowledge`, compatible OpenClaw versions, and installation instructions referencing the `mcp.json` configuration.
7. THE MCP_Server documentation (AGENTS.md) SHALL include an "OpenClaw Integration" section with step-by-step setup instructions for installing Mycelium as an OpenClaw skill, configuring the API key, and verifying the connection.

### Requirement 15: OpenClaw Session Context Protocol

**User Story:** As an OpenClaw agent, I want the MCP Server to support session-scoped context, so that I can maintain working memory across tool calls within a single session without polluting the permanent knowledge base.

#### Acceptance Criteria

1. THE MCP_Server SHALL provide a `set_session_context` tool that accepts a `key` string and `value` string, storing the key-value pair in an in-memory session store scoped to the current MCP connection.
2. THE MCP_Server SHALL provide a `get_session_context` tool that accepts a `key` string and returns the stored value, or null if the key does not exist in the current session.
3. THE MCP_Server SHALL provide a `list_session_context` tool that returns all key-value pairs in the current session store.
4. WHEN the MCP connection is closed, THE MCP_Server SHALL discard all session context data for that connection.
5. THE session context tools SHALL NOT require any API key scopes beyond the base `agent:read` scope, as session data is ephemeral and not persisted to the database.
6. THE session context store SHALL enforce a maximum of 100 keys per session and a maximum value size of 10KB per key, returning a validation error if either limit is exceeded.
