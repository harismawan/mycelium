# Requirements Document

## Introduction

Note Templates allow users and AI agents to create notes from predefined structures. Templates are Markdown files with placeholder variables (e.g., `{{date}}`, `{{title}}`) that auto-fill at instantiation time. Mycelium ships with built-in templates (Meeting Notes, Daily Journal, Research Summary, Project Plan) and lets users create custom templates stored in the database. The SPA presents a template picker during note creation, and the REST API accepts a template identifier so agents can create templated notes programmatically.

## Glossary

- **Template**: A reusable Markdown document defining the structure (headings, sections, placeholder text) and optional default metadata (tags, status) for a new note.
- **Template_Variable**: A placeholder token in the form `{{variable_name}}` embedded in template content that the Template_Engine replaces with a concrete value at instantiation time.
- **Template_Engine**: The component responsible for parsing template content, resolving Template_Variables, and producing the final Markdown output.
- **Built_In_Template**: A Template that ships with Mycelium and is available to all users without requiring creation. Built-in templates are read-only.
- **Custom_Template**: A user-created Template stored in the database, owned by the creating user.
- **Template_Picker**: A UI component in the SPA that displays available templates and lets the user select one when creating a new note.
- **Template_Service**: The backend service responsible for CRUD operations on templates and for instantiating notes from templates.
- **Template_Metadata**: Optional default values attached to a Template, including default tags and default note status, applied to notes created from that template.
- **SPA**: The React single-page application (apps/web) used by human users.
- **Agent_API**: The REST API endpoints used by AI agents to interact with Mycelium.
- **NoteService**: The existing backend service that handles note CRUD operations.

## Requirements

### Requirement 1: Template Storage Model

**User Story:** As a developer, I want templates stored with a clear schema, so that both built-in and custom templates can be managed consistently.

#### Acceptance Criteria

1. THE Template_Service SHALL store each Template with a unique identifier, a name, a description, Markdown content with Template_Variables, Template_Metadata (default tags, default status), a built-in flag, and an owner reference for Custom_Templates.
2. WHEN a Template is marked as built-in, THE Template_Service SHALL set the owner reference to null.
3. WHEN a Custom_Template is created, THE Template_Service SHALL associate the Template with the creating user's identifier.
4. THE Template_Service SHALL enforce unique template names per user scope (a user cannot have two Custom_Templates with the same name, but a Custom_Template may share a name with a Built_In_Template).

### Requirement 2: Built-In Templates

**User Story:** As a user, I want a set of ready-made templates available immediately, so that I can quickly create structured notes without setup.

#### Acceptance Criteria

1. THE Template_Service SHALL provide the following Built_In_Templates: "Meeting Notes", "Daily Journal", "Research Summary", and "Project Plan".
2. WHEN a user requests the template list, THE Template_Service SHALL include all Built_In_Templates regardless of the requesting user.
3. THE Template_Service SHALL mark each Built_In_Template as read-only so that no user can update or delete a Built_In_Template.
4. WHEN a user attempts to update or delete a Built_In_Template, THE Template_Service SHALL return an error indicating the template is read-only.

### Requirement 3: Custom Template CRUD

**User Story:** As a user, I want to create, view, update, and delete my own templates, so that I can define reusable structures tailored to my workflow.

#### Acceptance Criteria

1. WHEN a user submits a valid template name, description, Markdown content, and optional Template_Metadata, THE Template_Service SHALL create a new Custom_Template owned by that user.
2. WHEN a user requests the template list, THE Template_Service SHALL return all Built_In_Templates combined with the Custom_Templates owned by that user.
3. WHEN a user requests a single template by identifier, THE Template_Service SHALL return the Template if the template is built-in or owned by the requesting user.
4. WHEN a user requests a template that does not exist or is owned by another user, THE Template_Service SHALL return a not-found error.
5. WHEN a user submits an update to a Custom_Template the user owns, THE Template_Service SHALL apply the changes and return the updated Template.
6. WHEN a user requests deletion of a Custom_Template the user owns, THE Template_Service SHALL remove the Template from the database.

### Requirement 4: Template Variable Definition and Resolution

**User Story:** As a user, I want placeholder variables in templates to auto-fill with contextual values, so that new notes are pre-populated with relevant information.

#### Acceptance Criteria

1. THE Template_Engine SHALL recognize Template_Variables in the format `{{variable_name}}` within template Markdown content.
2. THE Template_Engine SHALL support the following built-in variables: `{{date}}` (current date in ISO 8601 date format YYYY-MM-DD), `{{datetime}}` (current date and time in ISO 8601 format), `{{title}}` (the note title provided at creation), and `{{author}}` (the display name of the creating user).
3. WHEN a Template_Variable matches a built-in variable name, THE Template_Engine SHALL replace the variable with the corresponding resolved value.
4. WHEN a Template_Variable does not match any built-in variable name and no custom value is provided, THE Template_Engine SHALL leave the placeholder text unchanged in the output.
5. WHEN a caller provides custom variable values at instantiation time, THE Template_Engine SHALL use the provided values to replace the corresponding Template_Variables.
6. FOR ALL valid template content strings, parsing the Template_Variables and then rendering the content back with the same variable values SHALL produce an equivalent output (round-trip property).

### Requirement 5: Note Creation from Template via SPA

**User Story:** As a user, I want to pick a template when creating a new note in the SPA, so that the note starts with the structure I need.

#### Acceptance Criteria

1. WHEN the user activates the "New Note" action in the NoteListPanel, THE Template_Picker SHALL appear displaying all available templates (Built_In_Templates and the user's Custom_Templates) plus a "Blank Note" option.
2. WHEN the user selects a template from the Template_Picker, THE SPA SHALL send a note creation request to the API with the selected template identifier and an optional title.
3. WHEN the user selects the "Blank Note" option, THE SPA SHALL create a note with no template applied, preserving the current behavior.
4. WHEN the user dismisses the Template_Picker without selecting a template, THE SPA SHALL cancel the note creation and return to the previous view.
5. THE Template_Picker SHALL display each template's name and description to help the user choose.

### Requirement 6: Note Creation from Template via API

**User Story:** As an AI agent, I want to create notes from templates via the REST API, so that I can generate structured notes programmatically.

#### Acceptance Criteria

1. WHEN the API receives a note creation request with a valid template identifier, THE Template_Service SHALL resolve the template, apply the Template_Engine to fill variables, merge Template_Metadata with any explicitly provided metadata, and delegate to NoteService to create the note.
2. WHEN the API receives a note creation request with a template identifier that does not exist or is not accessible to the requesting user, THE Template_Service SHALL return a not-found error.
3. WHEN the API receives a note creation request with both a template identifier and explicit content, THE Template_Service SHALL use the template-generated content and ignore the explicit content field.
4. WHEN the API receives a note creation request with a template identifier and explicit tags, THE Template_Service SHALL merge the explicit tags with the template's default tags, removing duplicates.
5. WHEN the API receives a note creation request with a template identifier and an explicit status, THE Template_Service SHALL use the explicit status, overriding the template's default status.
6. WHEN the API receives a note creation request with a template identifier and custom variable values, THE Template_Service SHALL pass the custom values to the Template_Engine for variable resolution.

### Requirement 7: Template Metadata Defaults

**User Story:** As a user, I want templates to carry default tags and status, so that notes created from a template inherit sensible defaults without manual entry.

#### Acceptance Criteria

1. WHEN a Template defines default tags in its Template_Metadata, THE Template_Service SHALL apply those tags to the created note unless overridden by explicit tags in the creation request.
2. WHEN a Template defines a default status in its Template_Metadata, THE Template_Service SHALL apply that status to the created note unless overridden by an explicit status in the creation request.
3. WHEN a Template defines no default tags, THE Template_Service SHALL create the note with no tags unless tags are provided explicitly.
4. WHEN a Template defines no default status, THE Template_Service SHALL create the note with the system default status (DRAFT).

### Requirement 8: Template API Endpoints

**User Story:** As a developer, I want dedicated REST endpoints for template management, so that both the SPA and agents can list, create, read, update, and delete templates.

#### Acceptance Criteria

1. THE Template_Service SHALL expose a GET endpoint that returns all templates accessible to the authenticated user (Built_In_Templates and the user's Custom_Templates).
2. THE Template_Service SHALL expose a GET endpoint that returns a single template by identifier, accessible if the template is built-in or owned by the authenticated user.
3. THE Template_Service SHALL expose a POST endpoint that creates a new Custom_Template owned by the authenticated user.
4. THE Template_Service SHALL expose a PATCH endpoint that updates a Custom_Template owned by the authenticated user.
5. THE Template_Service SHALL expose a DELETE endpoint that removes a Custom_Template owned by the authenticated user.
6. WHEN an unauthenticated request is made to any template endpoint, THE Template_Service SHALL return an authentication error.

### Requirement 9: Template Variable Parsing Robustness

**User Story:** As a developer, I want the template variable parser to handle edge cases gracefully, so that malformed or nested placeholders do not break note creation.

#### Acceptance Criteria

1. WHEN template content contains a malformed placeholder (e.g., `{{`, `{{}}`, `{{ }}`, `{{date`), THE Template_Engine SHALL leave the malformed text unchanged in the output.
2. WHEN template content contains nested placeholders (e.g., `{{{{date}}}}`), THE Template_Engine SHALL resolve only the innermost valid placeholder and leave surrounding braces unchanged.
3. WHEN template content contains no Template_Variables, THE Template_Engine SHALL return the content unchanged.
4. WHEN template content is an empty string, THE Template_Engine SHALL return an empty string.
