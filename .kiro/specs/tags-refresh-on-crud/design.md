# Tags Refresh on CRUD Bugfix Design

## Overview

The sidebar tags list does not refresh after four specific note mutation operations: archive, permanent delete, restore, and revert-to-revision. All four code paths modify note state (which can change which tags are active) but only invalidate the `['notes']` query key, omitting the `['tags']` query key. The fix adds `queryClient.invalidateQueries({ queryKey: tagKeys.all })` to each of the four affected code paths so TanStack Query refetches the tags list after every note mutation that could change tag counts.

## Glossary

- **Bug_Condition (C)**: A note mutation is performed through one of the four affected code paths (confirmArchive, confirmDelete, handleRestore in `NoteListPanel.jsx`, or `useRevertNote` in `hooks.js`) and the `['tags']` query key is not invalidated afterward
- **Property (P)**: After any note mutation that changes note status or content, the `['tags']` query key is invalidated so the sidebar tags list reflects the current state
- **Preservation**: Existing query invalidation behavior (notes, note detail, revisions, activity log, graph) must remain unchanged; hooks that already invalidate tags (`useCreateNote`, `useUpdateNote`, `useArchiveNote`) must continue to do so
- **`tagKeys.all`**: The query key factory `['tags']` defined in `apps/web/src/api/hooks.js` used by `useTags()` to fetch all tags with note counts
- **`NoteListPanel.jsx`**: The component at `apps/web/src/components/NoteListPanel.jsx` that renders the note list and performs archive, delete, and restore operations via direct API calls
- **`useRevertNote`**: The mutation hook in `apps/web/src/api/hooks.js` that reverts a note to a previous revision

## Bug Details

### Bug Condition

The bug manifests when a user performs a note mutation through one of four code paths that modify note state without invalidating the tags query. Three of these are inline handlers in `NoteListPanel.jsx` that call the API client directly and manually invalidate only `['notes']`. The fourth is the `useRevertNote` hook in `hooks.js` that invalidates notes, note detail, markdown, revisions, and activity log — but not tags.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { operation: string, codePath: string }
  OUTPUT: boolean

  RETURN input.codePath IN [
           'NoteListPanel.confirmArchive',
           'NoteListPanel.confirmDelete',
           'NoteListPanel.handleRestore',
           'hooks.useRevertNote'
         ]
         AND input.operation IN ['archive', 'permanentDelete', 'restore', 'revert']
         AND NOT tagsQueryInvalidated(input.codePath)
END FUNCTION
```

### Examples

- **Archive**: User archives a note tagged `#project-alpha`. The note list updates (note disappears from drafts), but the sidebar still shows `project-alpha (3)` instead of `project-alpha (2)`.
- **Permanent Delete**: User permanently deletes the last note tagged `#obsolete`. The note list updates, but the sidebar still shows `obsolete (1)` instead of removing the tag entirely.
- **Restore**: User restores an archived note tagged `#meeting-notes`. The note reappears in drafts, but the sidebar tag count for `meeting-notes` does not increment.
- **Revert**: User reverts a note to a revision that had tag `#draft` instead of current tag `#final`. The note content reverts, but the sidebar still shows `final` instead of `draft`.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- `useCreateNote` hook must continue to invalidate `['notes']`, `['tags']`, and `['graph']` on success
- `useUpdateNote` hook must continue to invalidate `['notes']`, note detail, markdown, `['tags']`, `['graph']`, revisions, and backlinks on success
- `useArchiveNote` hook must continue to invalidate `['notes']`, `['tags']`, and `['graph']` on success
- All four affected code paths must continue to invalidate `['notes']` as they do currently
- `useRevertNote` must continue to invalidate note detail, markdown, revisions, and activity log queries
- Mouse/keyboard interactions, navigation, search filtering, and UI rendering in `NoteListPanel` must remain unchanged

**Scope:**
All inputs that do NOT involve the four affected code paths should be completely unaffected by this fix. This includes:
- Note creation via `useCreateNote` (already invalidates tags)
- Note editing via `useUpdateNote` (already invalidates tags)
- Archive via `useArchiveNote` hook (already invalidates tags)
- All read operations (fetching notes, tags, graph, revisions)
- UI interactions unrelated to note mutations

## Hypothesized Root Cause

Based on the bug description and code analysis, the root cause is confirmed (not hypothesized):

1. **`NoteListPanel.confirmArchive`** (line ~168): Calls `apiDelete(\`/notes/${slug}\`)` then only invalidates `{ queryKey: ['notes'] }`. Missing `tagKeys.all` invalidation.

2. **`NoteListPanel.confirmDelete`** (line ~180): Calls `apiDelete(\`/notes/${slug}/permanent\`)` then only invalidates `{ queryKey: ['notes'] }`. Missing `tagKeys.all` invalidation.

3. **`NoteListPanel.handleRestore`** (line ~191): Calls `apiPatch(\`/notes/${slug}\`, { status: 'DRAFT' })` then only invalidates `{ queryKey: ['notes'] }`. Missing `tagKeys.all` invalidation.

4. **`hooks.useRevertNote`** (line ~218): `onSuccess` invalidates `noteKeys.all`, `noteKeys.detail(slug)`, `noteKeys.md(slug)`, `revKeys.list(slug)`, and `activityKeys.all` — but not `tagKeys.all`.

The pattern is clear: these code paths were written without considering that note mutations can change the set of active tags. The existing hooks (`useCreateNote`, `useUpdateNote`, `useArchiveNote`) correctly invalidate tags, but these four paths were missed.

## Correctness Properties

Property 1: Bug Condition - Tags Query Invalidated After Note Mutation

_For any_ note mutation performed through one of the four affected code paths (confirmArchive, confirmDelete, handleRestore, useRevertNote), the fixed code SHALL invalidate the `['tags']` query key so that the sidebar tags list is refetched and displays current tag data.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - Existing Query Invalidations Unchanged

_For any_ note mutation performed through any code path (including the four fixed paths and the already-correct hooks), the fixed code SHALL continue to invalidate all previously-invalidated query keys, preserving existing cache refresh behavior for notes, note detail, revisions, activity log, and graph queries.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

**File**: `apps/web/src/components/NoteListPanel.jsx`

**Import Change**: Add `tagKeys` to the import from `../api/hooks.js`:
```js
import { useNotes, useCreateNote, tagKeys } from '../api/hooks.js';
```

**Function**: `confirmArchive`

**Specific Change**: Add tags query invalidation after the existing notes invalidation:
```js
qc.invalidateQueries({ queryKey: ['notes'] });
qc.invalidateQueries({ queryKey: tagKeys.all });
```

**Function**: `confirmDelete`

**Specific Change**: Add tags query invalidation after the existing notes invalidation:
```js
qc.invalidateQueries({ queryKey: ['notes'] });
qc.invalidateQueries({ queryKey: tagKeys.all });
```

**Function**: `handleRestore`

**Specific Change**: Add tags query invalidation after the existing notes invalidation:
```js
qc.invalidateQueries({ queryKey: ['notes'] });
qc.invalidateQueries({ queryKey: tagKeys.all });
```

---

**File**: `apps/web/src/api/hooks.js`

**Function**: `useRevertNote`

**Specific Change**: Add tags query invalidation to the `onSuccess` callback:
```js
onSuccess: () => {
  qc.invalidateQueries({ queryKey: noteKeys.all });
  qc.invalidateQueries({ queryKey: noteKeys.detail(slug) });
  qc.invalidateQueries({ queryKey: noteKeys.md(slug) });
  qc.invalidateQueries({ queryKey: revKeys.list(slug) });
  qc.invalidateQueries({ queryKey: activityKeys.all });
  qc.invalidateQueries({ queryKey: tagKeys.all });
},
```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm the root cause by verifying that the four code paths do not call `invalidateQueries` with the `['tags']` query key.

**Test Plan**: Write tests that mock `useQueryClient` and the API client, trigger each of the four mutation code paths, and assert that `invalidateQueries` was NOT called with `{ queryKey: ['tags'] }`. Run these tests on the UNFIXED code to observe the bug.

**Test Cases**:
1. **Archive Test**: Call `confirmArchive` and verify `invalidateQueries` is not called with `['tags']` (will pass on unfixed code, confirming the bug)
2. **Delete Test**: Call `confirmDelete` and verify `invalidateQueries` is not called with `['tags']` (will pass on unfixed code, confirming the bug)
3. **Restore Test**: Call `handleRestore` and verify `invalidateQueries` is not called with `['tags']` (will pass on unfixed code, confirming the bug)
4. **Revert Test**: Call `useRevertNote.onSuccess` and verify `invalidateQueries` is not called with `['tags']` (will pass on unfixed code, confirming the bug)

**Expected Counterexamples**:
- None of the four code paths call `invalidateQueries` with `['tags']`
- Cause: each path was written to only invalidate `['notes']` (and in the revert case, additional note-specific keys)

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := executeMutation_fixed(input)
  ASSERT tagKeys.all IN invalidatedQueryKeys(result)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalInvalidatedKeys(input) SUBSET_OF fixedInvalidatedKeys(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for the existing hooks (`useCreateNote`, `useUpdateNote`, `useArchiveNote`), then write property-based tests capturing that those hooks still invalidate the same query keys after the fix.

**Test Cases**:
1. **Notes Query Preservation**: Verify all four fixed code paths still invalidate `['notes']` after the fix
2. **Revert Detail Preservation**: Verify `useRevertNote` still invalidates note detail, markdown, revisions, and activity log after the fix
3. **Existing Hook Preservation**: Verify `useCreateNote`, `useUpdateNote`, and `useArchiveNote` still invalidate `['tags']` after the fix (no regression)

### Unit Tests

- Test that `confirmArchive` invalidates both `['notes']` and `['tags']`
- Test that `confirmDelete` invalidates both `['notes']` and `['tags']`
- Test that `handleRestore` invalidates both `['notes']` and `['tags']`
- Test that `useRevertNote.onSuccess` invalidates `['tags']` in addition to existing keys

### Property-Based Tests

- Generate random note slugs and verify that after any of the four mutations, `invalidateQueries` is called with `['tags']`
- Generate random mutation sequences and verify all previously-invalidated query keys are still invalidated after the fix
- Test across random note states (draft, published, archived) that tag invalidation occurs for all status transitions

### Integration Tests

- Test full archive flow: archive a tagged note, verify tags list API is refetched
- Test full delete flow: permanently delete the last note with a tag, verify tag disappears from sidebar
- Test full restore flow: restore an archived note, verify tag counts update
- Test full revert flow: revert to a revision with different tags, verify sidebar reflects the change
