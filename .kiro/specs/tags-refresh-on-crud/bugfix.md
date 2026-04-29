# Bugfix Requirements Document

## Introduction

The tags list in the sidebar does not refresh after note CRUD operations (archive, permanent delete, restore from archive, and revert to revision). Users must manually reload the page to see updated tags. The root cause is that several code paths in `NoteListPanel.jsx` perform note mutations via direct API calls with manual query invalidation that only invalidates the `['notes']` query key but omits the `['tags']` query key. Additionally, the `useRevertNote` hook in `hooks.js` does not invalidate `['tags']` on success.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user archives a note from the note list panel THEN the system does not invalidate the tags query, causing the sidebar tags list to display stale tag data (including tags that may no longer have any associated active notes)

1.2 WHEN a user permanently deletes an archived note from the note list panel THEN the system does not invalidate the tags query, causing the sidebar tags list to display stale tag data (including tags from the deleted note)

1.3 WHEN a user restores an archived note back to draft status from the note list panel THEN the system does not invalidate the tags query, causing the sidebar tags list to not reflect the restored note's tags

1.4 WHEN a user reverts a note to a previous revision (which may have different tags) THEN the system does not invalidate the tags query, causing the sidebar tags list to display stale tag data that does not reflect the reverted note's tags

### Expected Behavior (Correct)

2.1 WHEN a user archives a note from the note list panel THEN the system SHALL invalidate the tags query so the sidebar tags list refreshes to reflect the current set of tags and their note counts

2.2 WHEN a user permanently deletes an archived note from the note list panel THEN the system SHALL invalidate the tags query so the sidebar tags list refreshes to remove tags that no longer have any associated notes

2.3 WHEN a user restores an archived note back to draft status from the note list panel THEN the system SHALL invalidate the tags query so the sidebar tags list refreshes to include the restored note's tags and updated counts

2.4 WHEN a user reverts a note to a previous revision THEN the system SHALL invalidate the tags query so the sidebar tags list refreshes to reflect any tag changes from the reverted revision

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user creates a new note with tags THEN the system SHALL CONTINUE TO invalidate the tags query and refresh the sidebar tags list (already working via `useCreateNote` hook)

3.2 WHEN a user updates a note's tags from the editor or right pane THEN the system SHALL CONTINUE TO invalidate the tags query and refresh the sidebar tags list (already working via `useUpdateNote` hook)

3.3 WHEN a user archives a note using the `useArchiveNote` hook directly THEN the system SHALL CONTINUE TO invalidate the tags query and refresh the sidebar tags list (already working via `useArchiveNote` hook)

3.4 WHEN a user performs any note mutation THEN the system SHALL CONTINUE TO invalidate the notes query so the note list panel refreshes correctly

3.5 WHEN a user reverts a note THEN the system SHALL CONTINUE TO invalidate the note detail, markdown, revision, and activity log queries as it does currently
