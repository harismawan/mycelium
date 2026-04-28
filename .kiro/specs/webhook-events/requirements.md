# Requirements Document

## Introduction

The Webhook and Event System enables Mycelium to notify external agents and services in real-time when changes occur in the knowledge base. Instead of polling the API, consumers register webhook URLs filtered by event type and receive signed HTTP POST payloads whenever notes are created, updated, archived, or deleted, links are formed or resolved, or tags are added or removed. The system includes HMAC-SHA256 payload signing, exponential-backoff retry logic for failed deliveries, a delivery log, and a management UI in the web settings.

## Glossary

- **Webhook**: A user-registered HTTP endpoint (URL) that receives POST requests when subscribed events occur in Mycelium.
- **Webhook_Secret**: A per-webhook random string used as the HMAC-SHA256 signing key for payload verification.
- **Event**: A discrete occurrence in the knowledge base that triggers webhook delivery — one of the defined event types.
- **Event_Type**: A dot-separated identifier describing the category and action of an event (e.g., `note.created`, `tag.added`).
- **Payload**: The JSON body sent in the HTTP POST request to a webhook URL, containing event metadata and the relevant resource data.
- **Delivery**: A single HTTP POST attempt to a webhook URL for a given event, including the response status and timing.
- **Delivery_Log**: A persistent record of all delivery attempts for a webhook, including status codes, timestamps, and error details.
- **Backoff**: An exponential delay strategy applied between retry attempts for failed deliveries.
- **Signature_Header**: The HTTP header (`X-Mycelium-Signature-256`) containing the HMAC-SHA256 hex digest of the payload, used by consumers to verify authenticity.
- **NoteService**: The existing Mycelium service handling note CRUD, the Markdown save pipeline, wikilink reconciliation, and revision management.
- **LinkService**: The existing Mycelium service handling wikilink reconciliation, unresolved-link resolution, and backlink queries.
- **Webhook_Service**: The new service responsible for managing webhook registrations, emitting events, signing payloads, and orchestrating deliveries.
- **Settings_UI**: The webhook management interface within the Mycelium web application settings panel.

## Requirements

### Requirement 1: Event Type Definitions

**User Story:** As a developer integrating with Mycelium, I want a well-defined set of event types, so that I can subscribe only to the changes I care about.

#### Acceptance Criteria

1. THE Webhook_Service SHALL support the following event types: `note.created`, `note.updated`, `note.archived`, `note.deleted`, `link.created`, `link.resolved`, `tag.added`, `tag.removed`.
2. THE Webhook_Service SHALL include the event type string in every delivered payload under the `event` field.
3. THE Webhook_Service SHALL include a monotonically increasing `eventId` (unique identifier) in every delivered payload.
4. THE Webhook_Service SHALL include an ISO 8601 `timestamp` in every delivered payload indicating when the event occurred.

### Requirement 2: Webhook Registration

**User Story:** As a Mycelium user, I want to register webhook URLs with event filters, so that only relevant events are sent to each endpoint.

#### Acceptance Criteria

1. WHEN a user submits a valid webhook URL and at least one event type filter, THE Webhook_Service SHALL create a new webhook registration associated with the authenticated user.
2. THE Webhook_Service SHALL generate a unique Webhook_Secret for each new registration and return the secret exactly once in the creation response.
3. THE Webhook_Service SHALL validate that the webhook URL uses the HTTPS scheme.
4. IF the webhook URL does not use HTTPS, THEN THE Webhook_Service SHALL reject the registration with a validation error describing the HTTPS requirement.
5. THE Webhook_Service SHALL allow a user to register multiple webhooks, each with different URL and event filter combinations.
6. THE Webhook_Service SHALL store the event type filter as an array of Event_Type strings on the webhook registration.
7. IF the user provides an event type not in the supported set, THEN THE Webhook_Service SHALL reject the registration with a validation error listing the valid event types.

### Requirement 3: Webhook Management

**User Story:** As a Mycelium user, I want to update, enable, disable, and delete my webhooks, so that I can control which integrations are active.

#### Acceptance Criteria

1. WHEN a user requests to update a webhook, THE Webhook_Service SHALL allow modification of the URL, event type filters, and active status.
2. WHEN a user requests to delete a webhook, THE Webhook_Service SHALL remove the webhook registration and all associated delivery log entries.
3. THE Webhook_Service SHALL support an `active` boolean flag on each webhook registration, defaulting to `true` on creation.
4. WHILE a webhook has its `active` flag set to `false`, THE Webhook_Service SHALL skip delivery to that webhook for all events.
5. WHEN a user requests to regenerate the Webhook_Secret, THE Webhook_Service SHALL generate a new secret, invalidate the previous secret, and return the new secret exactly once.
6. THE Webhook_Service SHALL allow a user to list all webhook registrations, returning the id, URL, event filters, active status, and creation timestamp for each.

### Requirement 4: Payload Structure and Signing

**User Story:** As a developer receiving webhooks, I want payloads to be signed with HMAC-SHA256, so that I can verify the request originated from Mycelium and was not tampered with.

#### Acceptance Criteria

1. WHEN delivering an event, THE Webhook_Service SHALL construct a JSON payload containing the fields: `event` (Event_Type), `eventId` (unique string), `timestamp` (ISO 8601), and `data` (event-specific resource object).
2. THE Webhook_Service SHALL compute an HMAC-SHA256 hex digest of the raw JSON payload body using the webhook's Webhook_Secret as the key.
3. THE Webhook_Service SHALL include the computed digest in the `X-Mycelium-Signature-256` HTTP header of the delivery request, prefixed with `sha256=`.
4. THE Webhook_Service SHALL set the `Content-Type` header to `application/json` on all delivery requests.
5. THE Webhook_Service SHALL set a `User-Agent` header of `Mycelium-Webhooks/1.0` on all delivery requests.
6. FOR ALL valid payloads, computing HMAC-SHA256 of the raw body with the Webhook_Secret and comparing to the Signature_Header SHALL confirm authenticity (round-trip verification property).

### Requirement 5: Event-Specific Payload Data

**User Story:** As a developer receiving webhooks, I want each event payload to contain the relevant resource data, so that I can react to changes without making additional API calls.

#### Acceptance Criteria

1. WHEN a `note.created` event fires, THE Webhook_Service SHALL include the note's id, slug, title, status, tags, and createdAt in the payload `data` field.
2. WHEN a `note.updated` event fires, THE Webhook_Service SHALL include the note's id, slug, title, status, tags, updatedAt, and an array of changed field names in the payload `data` field.
3. WHEN a `note.archived` event fires, THE Webhook_Service SHALL include the note's id, slug, and title in the payload `data` field.
4. WHEN a `note.deleted` event fires, THE Webhook_Service SHALL include the note's id, slug, and title in the payload `data` field.
5. WHEN a `link.created` event fires, THE Webhook_Service SHALL include the link's fromId, toId, toTitle, and the source note's slug in the payload `data` field.
6. WHEN a `link.resolved` event fires, THE Webhook_Service SHALL include the link's fromId, toId, the resolved note's slug, and the previously unresolved toTitle in the payload `data` field.
7. WHEN a `tag.added` event fires, THE Webhook_Service SHALL include the tag name, the note's id, and the note's slug in the payload `data` field.
8. WHEN a `tag.removed` event fires, THE Webhook_Service SHALL include the tag name, the note's id, and the note's slug in the payload `data` field.

### Requirement 6: Event Emission from Existing Services

**User Story:** As a system maintainer, I want events to be emitted from the existing NoteService and LinkService operations, so that webhook delivery is triggered by real changes without duplicating business logic.

#### Acceptance Criteria

1. WHEN NoteService.createNote completes successfully, THE NoteService SHALL emit a `note.created` event with the created note data.
2. WHEN NoteService.updateNote completes successfully, THE NoteService SHALL emit a `note.updated` event with the updated note data and changed fields.
3. WHEN NoteService.archiveNote completes successfully, THE NoteService SHALL emit a `note.archived` event with the archived note data.
4. WHEN NoteService.deleteNote completes successfully, THE NoteService SHALL emit a `note.deleted` event with the deleted note's id, slug, and title.
5. WHEN a new Link record is created during wikilink reconciliation, THE NoteService SHALL emit a `link.created` event with the link data.
6. WHEN an unresolved link is resolved to a target note, THE NoteService SHALL emit a `link.resolved` event with the link data and previously unresolved title.
7. WHEN tags are added to a note during create or update, THE NoteService SHALL emit a `tag.added` event for each newly associated tag.
8. WHEN tags are removed from a note during update, THE NoteService SHALL emit a `tag.removed` event for each disassociated tag.
9. THE event emission SHALL occur after the database transaction commits successfully, ensuring events reflect persisted state.

### Requirement 7: Webhook Delivery

**User Story:** As a developer receiving webhooks, I want Mycelium to deliver events reliably via HTTP POST, so that my integrations receive timely notifications.

#### Acceptance Criteria

1. WHEN an event is emitted, THE Webhook_Service SHALL identify all active webhooks owned by the event's user whose event filters include the emitted event type.
2. THE Webhook_Service SHALL send an HTTP POST request to each matching webhook URL with the signed payload.
3. THE Webhook_Service SHALL consider a delivery successful when the webhook endpoint returns an HTTP status code in the 2xx range.
4. THE Webhook_Service SHALL enforce a 10-second timeout on each delivery HTTP request.
5. IF the delivery HTTP request times out, THEN THE Webhook_Service SHALL treat the delivery as failed and schedule a retry.
6. THE Webhook_Service SHALL process deliveries asynchronously so that event emission does not block the originating API request.

### Requirement 8: Retry Logic with Exponential Backoff

**User Story:** As a developer receiving webhooks, I want failed deliveries to be retried with exponential backoff, so that transient failures do not cause permanent event loss.

#### Acceptance Criteria

1. WHEN a delivery attempt fails (non-2xx response or timeout), THE Webhook_Service SHALL schedule a retry using exponential backoff.
2. THE Webhook_Service SHALL retry failed deliveries up to a maximum of 5 attempts.
3. THE Webhook_Service SHALL calculate retry delays as: 10 seconds, 30 seconds, 90 seconds, 270 seconds, 810 seconds (base 10 seconds with 3x multiplier).
4. WHEN all retry attempts for a delivery are exhausted, THE Webhook_Service SHALL mark the delivery as permanently failed in the Delivery_Log.
5. IF a webhook accumulates 10 consecutive permanently failed deliveries, THEN THE Webhook_Service SHALL set the webhook's `active` flag to `false` and record the deactivation reason.

### Requirement 9: Delivery Logging

**User Story:** As a Mycelium user, I want to view the delivery history for my webhooks, so that I can diagnose integration issues and verify events are being received.

#### Acceptance Criteria

1. THE Webhook_Service SHALL create a Delivery_Log entry for every delivery attempt, recording the webhook id, event type, event id, HTTP status code, response time in milliseconds, attempt number, and timestamp.
2. IF a delivery attempt fails with a network error, THEN THE Webhook_Service SHALL record the error message in the Delivery_Log entry instead of an HTTP status code.
3. THE Webhook_Service SHALL provide an API endpoint to list delivery log entries for a specific webhook, supporting cursor-based pagination.
4. THE Webhook_Service SHALL retain delivery log entries for 30 days, after which entries are eligible for deletion.
5. THE Webhook_Service SHALL return delivery log entries sorted by timestamp in descending order (most recent first).

### Requirement 10: Webhook Management API

**User Story:** As a developer or agent, I want REST API endpoints for managing webhooks, so that I can automate webhook configuration programmatically.

#### Acceptance Criteria

1. THE API SHALL expose a `POST /api/v1/webhooks` endpoint that creates a new webhook registration, accepting `url`, `events` (array of Event_Type strings), and an optional `description` field.
2. THE API SHALL expose a `GET /api/v1/webhooks` endpoint that lists all webhook registrations for the authenticated user.
3. THE API SHALL expose a `GET /api/v1/webhooks/:id` endpoint that returns a single webhook registration by id.
4. THE API SHALL expose a `PATCH /api/v1/webhooks/:id` endpoint that updates a webhook's url, events, description, or active status.
5. THE API SHALL expose a `DELETE /api/v1/webhooks/:id` endpoint that deletes a webhook registration and its delivery log entries.
6. THE API SHALL expose a `POST /api/v1/webhooks/:id/secret/rotate` endpoint that regenerates the Webhook_Secret and returns the new secret.
7. THE API SHALL expose a `GET /api/v1/webhooks/:id/deliveries` endpoint that returns paginated delivery log entries for the specified webhook.
8. THE API SHALL expose a `POST /api/v1/webhooks/:id/test` endpoint that sends a test `ping` event to the webhook URL with a signed payload.
9. THE API SHALL require authentication (JWT or API key) for all webhook management endpoints.

### Requirement 11: Webhook Management UI

**User Story:** As a Mycelium user, I want a webhook management section in the settings panel, so that I can register, configure, and monitor webhooks without using the API directly.

#### Acceptance Criteria

1. THE Settings_UI SHALL display a "Webhooks" section listing all registered webhooks with their URL, event filters, active status, and creation date.
2. WHEN the user clicks "Add Webhook", THE Settings_UI SHALL display a form to enter the webhook URL, select event type filters from checkboxes, and provide an optional description.
3. WHEN the user submits the add-webhook form, THE Settings_UI SHALL call the create webhook API endpoint and display the generated Webhook_Secret in a one-time-visible dialog with a copy button.
4. THE Settings_UI SHALL provide a toggle control on each webhook row to enable or disable the webhook.
5. WHEN the user clicks "Edit" on a webhook, THE Settings_UI SHALL display a form pre-populated with the current URL, event filters, and description, allowing modification.
6. WHEN the user clicks "Delete" on a webhook, THE Settings_UI SHALL display a confirmation dialog before calling the delete API endpoint.
7. WHEN the user clicks "View Deliveries" on a webhook, THE Settings_UI SHALL display a paginated table of delivery log entries showing event type, status code, response time, attempt number, and timestamp.
8. WHEN the user clicks "Rotate Secret" on a webhook, THE Settings_UI SHALL display a confirmation dialog, call the rotate secret endpoint, and display the new secret in a one-time-visible dialog.
9. THE Settings_UI SHALL display a "Send Test" button on each webhook that triggers a test ping delivery and shows the result.

### Requirement 12: Webhook Database Schema

**User Story:** As a system maintainer, I want webhook registrations and delivery logs stored in the PostgreSQL database via Prisma, so that the data is persistent, queryable, and consistent with the existing data model.

#### Acceptance Criteria

1. THE database schema SHALL include a `Webhook` model with fields: id (cuid), userId (foreign key to User), url (string), events (string array), secret (string), description (optional string), active (boolean, default true), createdAt (datetime), and updatedAt (datetime).
2. THE database schema SHALL include a `WebhookDelivery` model with fields: id (cuid), webhookId (foreign key to Webhook), eventType (string), eventId (string), statusCode (optional integer), responseTimeMs (optional integer), errorMessage (optional string), attemptNumber (integer), success (boolean), createdAt (datetime).
3. THE `Webhook` model SHALL cascade-delete associated `WebhookDelivery` records when a webhook is deleted.
4. THE database schema SHALL index the `Webhook` model on `userId` and the `WebhookDelivery` model on `webhookId` and `createdAt` for query performance.
5. THE `Webhook` model SHALL enforce a unique constraint on the combination of `userId` and `url` to prevent duplicate registrations for the same endpoint.
