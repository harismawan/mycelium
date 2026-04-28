# Requirements Document

## Introduction

Agent Activity Log and Audit Trail adds observability and governance to Mycelium's agent API. Every action performed by an AI agent through an API key is recorded in a dedicated activity log, agent identity is stamped on revisions, and the web UI surfaces agent-vs-human edits distinctly. Humans can review, approve, and revert agent changes, and per-key rate limiting prevents abuse.

## Glossary

- **Activity_Log**: A persistent record of a single agent action, storing the API key name, action type, target resource, timestamp, and contextual details.
- **Agent**: An AI consumer that authenticates via a Bearer API key and interacts with Mycelium through the REST API.
- **API_Key**: A credential record in the `ApiKey` table containing a name, hashed key, scopes, and usage metadata. Each API_Key belongs to a User.
- **Activity_Log_Service**: The backend service responsible for creating, querying, and managing Activity_Log records.
- **Revision**: An immutable snapshot of a note's content created on each save, stored in the `Revision` table.
- **Revision_Service**: The backend service responsible for listing and retrieving Revision records.
- **Rate_Limiter**: Middleware that tracks request counts per API_Key within a sliding time window and rejects requests that exceed the configured threshold.
- **Activity_Feed_Page**: A dedicated page in the web SPA that displays a chronological list of agent Activity_Log entries.
- **Revision_History_Panel**: The existing right-pane component (`RevisionHistory.jsx`) that lists Revision entries for a note.
- **Auth_Middleware**: The Elysia middleware plugin (`auth.js`) that resolves credentials and attaches `user`, `authType`, and `scopes` to the request context.
- **Note_Service**: The backend service handling note CRUD operations, the Markdown save pipeline, and revision creation.

## Requirements

### Requirement 1: Log Agent Actions

**User Story:** As a knowledge base owner, I want every agent action recorded with the API key name, timestamp, and details, so that I have a complete audit trail of agent activity.

#### Acceptance Criteria

1. WHEN an Agent performs a create, update, archive, or search action via the REST API, THE Activity_Log_Service SHALL create an Activity_Log record containing the API_Key name, the API_Key id, the user id, the action type, the target resource identifier, a timestamp, and a details object describing the action.
2. THE Activity_Log_Service SHALL store each Activity_Log record in a dedicated `ActivityLog` database table.
3. WHEN an Agent action fails due to a validation or authorization error, THE Activity_Log_Service SHALL still create an Activity_Log record with the error status and error message in the details object.
4. THE Activity_Log_Service SHALL record the action type using one of the following values: `note:create`, `note:update`, `note:archive`, `note:delete`, `note:search`, `bundle:read`.
5. IF the Activity_Log record cannot be persisted due to a database error, THEN THE Activity_Log_Service SHALL log the failure to the application logger without blocking the original API response.

### Requirement 2: Store Agent Identity on Revisions

**User Story:** As a knowledge base owner, I want each revision to record whether it was made by a human or an agent and which API key was used, so that I can trace every content change to its source.

#### Acceptance Criteria

1. WHEN a Revision is created as part of a note save, THE Note_Service SHALL store the `authType` value (`jwt` or `apikey`) on the Revision record.
2. WHEN a Revision is created by an Agent, THE Note_Service SHALL store the API_Key id and the API_Key name on the Revision record.
3. WHEN a Revision is created by a human user via JWT authentication, THE Note_Service SHALL store `null` for the API_Key id and API_Key name on the Revision record.
4. THE Revision_Service SHALL include the `authType`, `apiKeyId`, and `apiKeyName` fields when returning Revision records through the API.

### Requirement 3: Differentiate Agent and Human Edits in Revision History

**User Story:** As a knowledge base owner, I want to visually distinguish agent edits from human edits in the revision history, so that I can quickly identify which changes were made by agents.

#### Acceptance Criteria

1. WHEN the Revision_History_Panel renders a Revision with `authType` equal to `apikey`, THE Revision_History_Panel SHALL display a distinct visual indicator label showing the text "agent" and the API_Key name.
2. WHEN the Revision_History_Panel renders a Revision with `authType` equal to `jwt`, THE Revision_History_Panel SHALL display the revision without the agent indicator label.
3. THE Revision_History_Panel SHALL use a visually distinct background color or badge style for agent Revision entries that differentiates the entry from human Revision entries.
4. THE Revision_History_Panel SHALL display the agent indicator label using an accessible color contrast ratio of at least 4.5:1 against the background.

### Requirement 4: Activity Feed Page

**User Story:** As a knowledge base owner, I want a dedicated page showing recent agent actions in chronological order, so that I can monitor agent behavior across all notes.

#### Acceptance Criteria

1. THE Activity_Log_Service SHALL expose a paginated API endpoint that returns Activity_Log records for the authenticated user, ordered by timestamp descending.
2. THE Activity_Log_Service SHALL support cursor-based pagination on the Activity_Log listing endpoint, consistent with the existing pagination pattern used by Note_Service.
3. THE Activity_Log_Service SHALL support filtering Activity_Log records by action type and by API_Key name.
4. THE Activity_Feed_Page SHALL display each Activity_Log entry showing the API_Key name, action type, target resource title or slug, timestamp, and details summary.
5. THE Activity_Feed_Page SHALL provide filter controls allowing the user to filter by action type and by API_Key name.
6. THE Activity_Feed_Page SHALL be accessible from the sidebar navigation under a menu item labeled "Agent Activity".
7. WHEN the Activity_Feed_Page has no Activity_Log records to display, THE Activity_Feed_Page SHALL show an empty state message indicating no agent activity has been recorded.

### Requirement 5: Review and Revert Agent Changes

**User Story:** As a knowledge base owner, I want to review agent changes and revert a note to a previous revision, so that I can undo unwanted agent modifications.

#### Acceptance Criteria

1. WHEN a user selects a Revision in the Revision_History_Panel, THE Revision_History_Panel SHALL display a side-by-side diff between the selected Revision content and the current note content, using the existing DiffView component.
2. WHEN a user views a Revision created by an Agent, THE Revision_History_Panel SHALL display a "Revert to this version" button.
3. WHEN a user clicks the "Revert to this version" button, THE Note_Service SHALL update the note content to the selected Revision content and create a new Revision with a message indicating the revert, including the original Revision id.
4. WHEN a user clicks the "Revert to this version" button, THE Revision_History_Panel SHALL display a confirmation dialog before executing the revert.
5. WHEN a revert is performed, THE Activity_Log_Service SHALL create an Activity_Log record with action type `note:revert` containing the reverted Revision id and the API_Key name of the original agent change.
6. THE Revision_History_Panel SHALL also display the "Revert to this version" button for human-created Revisions, enabling revert of any historical Revision.

### Requirement 6: Rate Limiting per API Key

**User Story:** As a knowledge base owner, I want per-API-key rate limiting on agent requests, so that a misconfigured or abusive agent cannot overwhelm the system.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL track request counts per API_Key id using a sliding window of 60 seconds.
2. THE Rate_Limiter SHALL enforce a default limit of 60 requests per 60-second window per API_Key.
3. WHEN an API_Key exceeds the rate limit, THE Rate_Limiter SHALL reject the request with HTTP status 429 and a JSON response body containing an `error` field with the message "Rate limit exceeded" and a `retryAfter` field indicating the number of seconds until the next request is allowed.
4. THE Rate_Limiter SHALL include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers on every agent API response.
5. THE Rate_Limiter SHALL apply only to requests authenticated via API_Key and SHALL NOT apply to requests authenticated via JWT.
6. IF the Rate_Limiter storage mechanism is unavailable, THEN THE Rate_Limiter SHALL allow the request to proceed and log a warning to the application logger.
