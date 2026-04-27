# Requirements Document

## Introduction

Mycelium is a web-based "second brain" system designed to serve two equally important audiences: human users through a polished single-page application (SPA), and AI agents (codename "openclaw") through a machine-friendly REST/JSON API with stable Markdown export. The system stores all content as Markdown with YAML frontmatter, treats relationships between notes as first-class citizens via wikilinks and backlinks, and provides a block-based editor that outputs clean Markdown. The architecture follows a monorepo layout (apps/api, apps/web, packages/shared) built on Bun, Elysia, PostgreSQL, Prisma, React, and Zustand.

## Glossary

- **Mycelium**: The overall web application comprising the API server and the SPA frontend that stores, organizes, and serves Markdown-based notes.
- **Note**: A unit of content stored as Markdown with YAML frontmatter, identified by a unique slug, containing a title, body content, tags, and relationship links.
- **Wikilink**: An inline reference within a Note's Markdown content using the `[[Note Title]]` syntax that creates a directional relationship to another Note.
- **Backlink**: An automatically computed inverse relationship indicating which Notes link to a given Note via Wikilinks.
- **Link**: A database record representing a directional relationship between two Notes, supporting typed relations and unresolved targets.
- **Tag**: A label applied to one or more Notes for categorical organization.
- **Revision**: An immutable snapshot of a Note's content captured on each save, enabling version history.
- **Frontmatter**: YAML metadata embedded at the top of a Note's Markdown content, parsed and stored separately for structured querying.
- **Excerpt**: A short text summary auto-generated from a Note's content on each save.
- **NoteStatus**: An enumeration of Note lifecycle states: DRAFT, PUBLISHED, or ARCHIVED.
- **API_Server**: The Elysia-based backend application serving REST/JSON endpoints under `/api/v1`.
- **SPA**: The React-based single-page application frontend served via Vite.
- **Agent**: An AI system (openclaw) that consumes Mycelium content through the machine-friendly API and API key authentication.
- **API_Key**: A scoped, revocable credential used by Agents to authenticate with the API_Server.
- **JWT**: A JSON Web Token issued to human users upon login, stored in an httpOnly cookie for session authentication.
- **Block_Editor**: The TipTap or BlockNote-based rich text editor in the SPA that provides block-level editing with slash commands and outputs clean Markdown.
- **Graph_View**: A visual representation of Notes and their Links rendered using react-force-graph-2d.
- **Command_Palette**: A keyboard-activated overlay (Cmd/Ctrl-K) for quick navigation and action execution within the SPA.
- **Markdown_Pipeline**: The remark/rehype processing chain used to parse and render Markdown content.
- **User**: A registered human account identified by email, with a hashed password and display name.
- **Seed_Script**: A database initialization script that creates a demo User, sample interlinked Notes, and an example API_Key for Mycelium.

## Requirements

### Requirement 1: Note Storage and Markdown Source of Truth

**User Story:** As a user, I want all my notes stored as Markdown with YAML frontmatter, so that my content remains portable, human-readable, and accessible to both the SPA and AI agents.

#### Acceptance Criteria

1. THE API_Server SHALL store each Note's content as Markdown with YAML frontmatter in the database.
2. WHEN a Note is saved, THE API_Server SHALL parse the YAML frontmatter and store the parsed metadata in the Note's frontmatter field.
3. WHEN a Note is saved, THE API_Server SHALL generate an excerpt from the Note's Markdown body and store the excerpt in the Note's excerpt field.
4. WHEN a Note is saved, THE API_Server SHALL create a new Revision row containing the full content and an optional commit message.
5. THE API_Server SHALL assign each Note a unique slug derived from the Note's title.
6. THE API_Server SHALL maintain createdAt and updatedAt timestamps on each Note.
7. THE API_Server SHALL support NoteStatus values of DRAFT, PUBLISHED, and ARCHIVED for each Note.
8. FOR ALL valid Note content, parsing the frontmatter then serializing it back to YAML then parsing again SHALL produce an equivalent frontmatter object (round-trip property).

### Requirement 2: Wikilink and Backlink Reconciliation

**User Story:** As a user, I want wikilinks between notes to be automatically tracked and backlinks computed, so that I can navigate relationships between my notes effortlessly.

#### Acceptance Criteria

1. WHEN a Note is saved, THE API_Server SHALL extract all Wikilinks from the Note's Markdown content using the `[[Note Title]]` syntax.
2. WHEN a Note is saved, THE API_Server SHALL reconcile the Link table by creating new Link records for newly added Wikilinks and removing Link records for deleted Wikilinks.
3. WHEN a Wikilink references a Note title that does not exist, THE API_Server SHALL create a Link record with a null toId and store the unresolved title in the toTitle field.
4. WHEN a new Note is created whose title matches an unresolved Link toTitle, THE API_Server SHALL update the Link record's toId to reference the newly created Note.
5. WHEN a Note's Backlinks are requested, THE API_Server SHALL return all Notes that contain a Wikilink pointing to the requested Note.
6. THE API_Server SHALL support an optional typed relation field on each Link record.
7. FOR ALL Note content containing N distinct Wikilinks, saving the Note SHALL result in exactly N Link records originating from that Note.

### Requirement 3: Human Authentication

**User Story:** As a human user, I want to register and log in with email and password, so that my notes are private and secure.

#### Acceptance Criteria

1. WHEN a registration request is received with a valid email and password, THE API_Server SHALL create a new User with a securely hashed password and return a success response.
2. WHEN a login request is received with valid credentials, THE API_Server SHALL issue a JWT stored in an httpOnly cookie and return the authenticated User's profile.
3. WHEN a logout request is received, THE API_Server SHALL clear the JWT cookie.
4. WHEN a request is received with a valid JWT cookie, THE API_Server SHALL identify the authenticated User and attach the User to the request context.
5. IF a registration request contains an email that is already registered, THEN THE API_Server SHALL return a 409 Conflict error.
6. IF a login request contains invalid credentials, THEN THE API_Server SHALL return a 401 Unauthorized error.
7. IF a request to a protected endpoint lacks a valid JWT cookie or API_Key, THEN THE API_Server SHALL return a 401 Unauthorized error.

### Requirement 4: Agent Authentication via API Keys

**User Story:** As an AI agent operator, I want to authenticate using scoped API keys, so that agents can access the knowledge base programmatically without human login flows.

#### Acceptance Criteria

1. WHEN an authenticated User requests creation of a new API_Key with a name and scopes, THE API_Server SHALL generate a unique key, store its hash, and return the plaintext key exactly once.
2. WHEN a request includes an `Authorization: Bearer <api_key>` header with a valid API_Key, THE API_Server SHALL authenticate the request as the API_Key's owning User.
3. THE API_Server SHALL enforce the scopes defined on the API_Key, restricting access to only the permitted operations.
4. WHEN an authenticated User requests revocation of an API_Key, THE API_Server SHALL delete the API_Key record and reject all subsequent requests using that key.
5. WHEN an API_Key is used for authentication, THE API_Server SHALL update the API_Key's lastUsedAt timestamp.
6. WHEN an authenticated User requests a list of API_Keys, THE API_Server SHALL return all API_Keys belonging to that User without exposing key hashes.
7. IF a request includes an API_Key that has been revoked or does not exist, THEN THE API_Server SHALL return a 401 Unauthorized error.

### Requirement 5: Notes CRUD API

**User Story:** As a user or agent, I want full CRUD operations on notes with filtering and pagination, so that I can manage my knowledge base content efficiently.

#### Acceptance Criteria

1. WHEN a create-note request is received with valid title and content, THE API_Server SHALL create a new Note, run frontmatter parsing, Wikilink extraction, excerpt generation, and Revision creation, then return the created Note.
2. WHEN a list-notes request is received, THE API_Server SHALL return a paginated list of Notes using cursor-based pagination.
3. WHEN a list-notes request includes filter parameters for status, tag, or search query, THE API_Server SHALL return only Notes matching all specified filters.
4. WHEN a get-note request is received for a valid slug, THE API_Server SHALL return the Note in JSON format by default.
5. WHEN a get-note request includes the query parameter `format=md`, THE API_Server SHALL return the Note's raw Markdown content with frontmatter.
6. WHEN a partial-update request is received for a valid Note, THE API_Server SHALL apply the provided fields, re-run frontmatter parsing, Wikilink reconciliation, excerpt generation, and Revision creation, then return the updated Note.
7. WHEN a delete request is received for a valid Note, THE API_Server SHALL perform a soft delete by setting the Note's status to ARCHIVED.
8. IF a create-note or update-note request fails validation, THEN THE API_Server SHALL return a 400 Bad Request error with descriptive validation messages.
9. IF a get-note or update-note request references a Note that does not exist, THEN THE API_Server SHALL return a 404 Not Found error.

### Requirement 6: Full-Text Search

**User Story:** As a user, I want to search across all my notes using full-text search, so that I can quickly find relevant content.

#### Acceptance Criteria

1. THE API_Server SHALL maintain a PostgreSQL tsvector index on Note title and content fields.
2. WHEN a search request is received with a query string, THE API_Server SHALL return Notes ranked by relevance using PostgreSQL full-text search.
3. WHEN a search request includes filter parameters for status or tag, THE API_Server SHALL combine full-text search with the specified filters.
4. THE API_Server SHALL return search results with cursor-based pagination.
5. WHEN a Note's title or content is updated, THE API_Server SHALL update the corresponding tsvector index.

### Requirement 7: Graph Endpoint

**User Story:** As a user, I want to retrieve a graph of linked notes, so that I can visualize the relationships in my knowledge base.

#### Acceptance Criteria

1. WHEN a graph request is received, THE API_Server SHALL return a JSON object containing a nodes array (Note id, slug, title, status) and an edges array (Link fromId, toId, relation).
2. WHEN a graph request includes a Note identifier, THE API_Server SHALL return only the subgraph of Notes within a configurable depth from the specified Note.
3. THE API_Server SHALL exclude ARCHIVED Notes from the graph response by default.

### Requirement 8: Tags Management

**User Story:** As a user, I want to organize notes with tags and browse notes by tag, so that I can categorize and filter my knowledge base.

#### Acceptance Criteria

1. THE API_Server SHALL provide an endpoint that returns all Tags with their associated Note counts.
2. WHEN a tag-name is provided, THE API_Server SHALL return a paginated list of Notes associated with that Tag.
3. WHEN a Note is saved with tags in the frontmatter or request body, THE API_Server SHALL create or associate the specified Tags with the Note.

### Requirement 9: Revision History

**User Story:** As a user, I want to view the revision history of any note, so that I can track changes and understand how content evolved.

#### Acceptance Criteria

1. WHEN a revisions request is received for a valid Note, THE API_Server SHALL return a paginated list of Revisions ordered by creation date descending.
2. THE API_Server SHALL store each Revision with the full Note content and an optional commit message.
3. WHEN a specific Revision is requested, THE API_Server SHALL return the full content of that Revision.

### Requirement 10: Agent-Specific Endpoints

**User Story:** As an AI agent, I want dedicated endpoints for discovering and bulk-fetching knowledge base content, so that I can efficiently consume the entire knowledge base.

#### Acceptance Criteria

1. WHEN a request is received at `/api/v1/agent/manifest`, THE API_Server SHALL return a JSON manifest describing available endpoints, content schema, and authentication requirements.
2. WHEN a request is received at `/api/v1/agent/bundle`, THE API_Server SHALL stream all PUBLISHED Notes as newline-delimited JSON (NDJSON).
3. WHEN a request is received at `/api/v1/agent/notes`, THE API_Server SHALL return Notes in a simplified JSON format optimized for Agent consumption.
4. THE API_Server SHALL require a valid API_Key with appropriate scopes for all Agent-specific endpoints.

### Requirement 11: Server-Side Validation

**User Story:** As a developer, I want all API inputs validated at the server boundary, so that the system rejects malformed data before processing.

#### Acceptance Criteria

1. THE API_Server SHALL validate all incoming request bodies, query parameters, and path parameters using Elysia's built-in TypeBox (t) schema validation on every route.
2. IF a request fails schema validation, THEN THE API_Server SHALL return a 400 Bad Request response with a structured error object describing the validation failures.
3. THE API_Server SHALL validate that Note content is valid Markdown with parseable YAML frontmatter before saving.

### Requirement 12: Observability and Health Checks

**User Story:** As an operator, I want health check endpoints and structured logging, so that I can monitor the system's operational status.

#### Acceptance Criteria

1. THE API_Server SHALL expose a `/health` endpoint that returns a 200 OK response when the server process is running.
2. THE API_Server SHALL expose a `/ready` endpoint that returns a 200 OK response only when the database connection is established and healthy.
3. IF the database connection is unhealthy, THEN THE `/ready` endpoint SHALL return a 503 Service Unavailable response.
4. THE API_Server SHALL emit structured JSON logs for all incoming requests, including method, path, status code, and response time.

### Requirement 13: SPA Shell and Routing

**User Story:** As a human user, I want a responsive single-page application with intuitive navigation, so that I can access all knowledge base features from my browser.

#### Acceptance Criteria

1. THE SPA SHALL render a three-pane layout consisting of a sidebar pane, a center editor pane, and a right detail pane.
2. THE SPA SHALL use client-side routing to navigate between note views, search results, graph view, and settings without full page reloads.
3. THE SPA SHALL manage authentication state using a Zustand useAuthStore that persists login status across browser sessions.
4. THE SPA SHALL manage note listing and selection state using a Zustand useNotesStore.
5. THE SPA SHALL manage editor state using a Zustand useEditorStore.
6. THE SPA SHALL manage UI preferences (theme, pane visibility, sidebar state) using a Zustand useUIStore with persist middleware.
7. THE SPA SHALL use TanStack Query for all server data fetching, caching, and synchronization.

### Requirement 14: Block-Based Markdown Editor

**User Story:** As a human user, I want a block-based editor that feels like Notion but outputs clean Markdown, so that I can write rich content that remains portable.

#### Acceptance Criteria

1. THE Block_Editor SHALL render Note content as editable blocks (paragraphs, headings, lists, code blocks, blockquotes, images).
2. WHEN a user types `/` at the start of a block, THE Block_Editor SHALL display a slash command menu for inserting new block types.
3. WHEN a user types `[[`, THE Block_Editor SHALL display an autocomplete dropdown listing existing Note titles filtered by the typed characters.
4. WHEN a user selects a Note from the Wikilink autocomplete, THE Block_Editor SHALL insert a `[[Note Title]]` Wikilink into the content.
5. THE Block_Editor SHALL support drag-and-drop image upload, storing the image and inserting a Markdown image reference.
6. WHEN the user saves, THE Block_Editor SHALL serialize the block content to clean Markdown with YAML frontmatter.
7. FOR ALL valid Markdown content loaded into the Block_Editor, serializing the editor state back to Markdown SHALL preserve the semantic structure of the original content (round-trip property).

### Requirement 15: Sidebar, Search, and Navigation

**User Story:** As a human user, I want a sidebar with tag/folder browsing, pinned notes, and quick search, so that I can navigate my knowledge base efficiently.

#### Acceptance Criteria

1. THE SPA sidebar SHALL display a tree view of Tags with expandable Note lists under each Tag.
2. THE SPA sidebar SHALL display a list of pinned Notes for quick access.
3. WHEN a user enters a search query in the sidebar search input, THE SPA SHALL send a search request to the API_Server and display matching Notes in the sidebar.
4. THE SPA SHALL provide a Command_Palette activated by Cmd/Ctrl-K that allows searching for Notes, Tags, and actions.
5. THE SPA SHALL support keyboard-first navigation throughout the interface.

### Requirement 16: Right Pane — Links, Backlinks, Tags, and Revisions

**User Story:** As a human user, I want to see a note's relationships, tags, and revision history in a right pane, so that I can understand context and track changes.

#### Acceptance Criteria

1. WHEN a Note is open in the editor, THE SPA right pane SHALL display the Note's outgoing Wikilinks as clickable navigation items.
2. WHEN a Note is open in the editor, THE SPA right pane SHALL display the Note's Backlinks as clickable navigation items.
3. WHEN a Note is open in the editor, THE SPA right pane SHALL display the Note's Tags.
4. WHEN a Note is open in the editor, THE SPA right pane SHALL display the Note's Revision history with timestamps and optional commit messages.
5. WHEN a user clicks a Revision entry, THE SPA SHALL display the full content of that Revision.

### Requirement 17: Graph Visualization

**User Story:** As a human user, I want an interactive graph view of my notes and their connections, so that I can visually explore the structure of my knowledge base.

#### Acceptance Criteria

1. THE SPA SHALL render an interactive force-directed graph using react-force-graph-2d showing Notes as nodes and Links as edges.
2. WHEN a user clicks a node in the Graph_View, THE SPA SHALL navigate to the corresponding Note in the editor.
3. THE Graph_View SHALL visually distinguish nodes by NoteStatus using different colors or shapes.
4. THE Graph_View SHALL support zoom and pan interactions.

### Requirement 18: Theming and Reading View

**User Story:** As a human user, I want light and dark themes with a distraction-free reading mode, so that I can customize my reading and writing experience.

#### Acceptance Criteria

1. THE SPA SHALL support light and dark color themes.
2. THE SPA SHALL detect the operating system's preferred color scheme and apply the matching theme by default.
3. WHEN a user manually selects a theme, THE SPA SHALL persist the selection using the useUIStore and apply the selected theme.
4. THE SPA SHALL provide a distraction-free reading view that hides the sidebar and right pane, displaying only the Note content in a centered, readable layout.

### Requirement 19: Client-Side Validation

**User Story:** As a human user, I want immediate feedback on invalid form inputs, so that I can correct errors before submitting.

#### Acceptance Criteria

1. THE SPA SHALL validate all form inputs using Zod schemas before submitting requests to the API_Server.
2. WHEN a form input fails Zod validation, THE SPA SHALL display an inline error message adjacent to the invalid field.
3. THE SPA SHALL validate Note title uniqueness by checking against the API_Server before saving a new Note.

### Requirement 20: Markdown Parsing and Rendering Pipeline

**User Story:** As a developer, I want a shared Markdown parsing and rendering pipeline, so that content is consistently processed across the API server and the SPA.

#### Acceptance Criteria

1. THE Markdown_Pipeline SHALL use remark for Markdown parsing and rehype for HTML rendering.
2. THE Markdown_Pipeline SHALL parse YAML frontmatter from Markdown content into a structured object.
3. THE Markdown_Pipeline SHALL extract Wikilinks from Markdown content and return a list of referenced Note titles.
4. THE Markdown_Pipeline SHALL render Wikilinks as navigable HTML links in the SPA.
5. FOR ALL valid Markdown content, parsing the Markdown to an AST then serializing the AST back to Markdown SHALL produce semantically equivalent content (round-trip property).
6. THE Markdown_Pipeline SHALL reside in the packages/shared workspace for use by both the API_Server and the SPA.

### Requirement 21: Database Schema and Migrations

**User Story:** As a developer, I want a well-defined Prisma schema with migrations, so that the database structure is version-controlled and reproducible.

#### Acceptance Criteria

1. Mycelium SHALL define a Prisma schema containing models for User, Note, Link, Tag, Revision, and ApiKey with the fields specified in the domain model.
2. Mycelium SHALL use Prisma Migrate to manage all database schema changes.
3. Mycelium SHALL define a NoteStatus enum in the Prisma schema with values DRAFT, PUBLISHED, and ARCHIVED.
4. THE Prisma schema SHALL define appropriate indexes on Note slug, Note status, Link fromId, Link toId, Tag name, and User email fields.

### Requirement 22: Seed Script and Demo Data

**User Story:** As a developer, I want a seed script that populates the database with demo data, so that I can quickly set up a working development environment.

#### Acceptance Criteria

1. WHEN the Seed_Script is executed, Mycelium SHALL create a demo User with a known email and password.
2. WHEN the Seed_Script is executed, Mycelium SHALL create at least 10 interlinked Notes with varied NoteStatus values, Tags, and Wikilinks.
3. WHEN the Seed_Script is executed, Mycelium SHALL create an example API_Key for the demo User with a known plaintext key for Agent testing.
4. THE Seed_Script SHALL be idempotent, producing the same result when run multiple times on an empty database.

### Requirement 23: Containerized Local Development

**User Story:** As a developer, I want a Docker Compose setup for local development, so that I can run the full stack with a single command.

#### Acceptance Criteria

1. Mycelium SHALL provide a Docker Compose configuration that starts a PostgreSQL 16 instance with a preconfigured database.
2. THE Docker Compose configuration SHALL expose the PostgreSQL port for local development tool access.
3. Mycelium SHALL provide a README with instructions for starting the development environment, running migrations, seeding the database, and starting the API_Server and SPA.

### Requirement 24: Agent Documentation

**User Story:** As an AI agent developer, I want comprehensive documentation of the agent API, so that I can integrate agents with the knowledge base.

#### Acceptance Criteria

1. Mycelium SHALL provide an AGENT.md file documenting all Agent-specific endpoints, authentication via API_Key, request and response schemas, and usage examples.
2. THE API_Server SHALL expose an OpenAPI/Swagger documentation endpoint generated by @elysiajs/swagger.

### Requirement 25: Monorepo and Project Structure

**User Story:** As a developer, I want a well-organized monorepo with shared packages, so that code is modular and reusable across the API server and SPA.

#### Acceptance Criteria

1. Mycelium SHALL use Bun workspaces to organize the codebase into apps/api, apps/web, and packages/shared directories.
2. THE packages/shared workspace SHALL contain the Markdown_Pipeline, Zod validation schemas, and shared constants used by both the API_Server and the SPA.
3. Mycelium SHALL use plain JavaScript with modern ESM module syntax throughout all workspaces.
4. Mycelium SHALL include JSDoc annotations on all exported functions in the packages/shared workspace.
