# Tasks

## 1. Add tags query invalidation to NoteListPanel.jsx
- [x] 1.1 Import `tagKeys` from `../api/hooks.js` in `NoteListPanel.jsx`
- [x] 1.2 Add `qc.invalidateQueries({ queryKey: tagKeys.all })` after the existing notes invalidation in `confirmArchive`
- [x] 1.3 Add `qc.invalidateQueries({ queryKey: tagKeys.all })` after the existing notes invalidation in `confirmDelete`
- [x] 1.4 Add `qc.invalidateQueries({ queryKey: tagKeys.all })` after the existing notes invalidation in `handleRestore`

## 2. Add tags query invalidation to useRevertNote hook
- [x] 2.1 Add `qc.invalidateQueries({ queryKey: tagKeys.all })` to the `onSuccess` callback of `useRevertNote` in `hooks.js`

## 3. Write exploratory tests to confirm the bug (pre-fix validation)
- [ ] 3.1 Create test file `apps/web/src/components/__tests__/NoteListPanel.tags-invalidation.test.jsx` with tests that verify the four code paths invalidate `['tags']`
  - [ ] 3.1.1 ~PBT: Property 1~ Write property test: for any note slug, `confirmArchive` triggers `invalidateQueries` with `tagKeys.all`
  - [ ] 3.1.2 ~PBT: Property 1~ Write property test: for any note slug, `confirmDelete` triggers `invalidateQueries` with `tagKeys.all`
  - [ ] 3.1.3 ~PBT: Property 1~ Write property test: for any note slug, `handleRestore` triggers `invalidateQueries` with `tagKeys.all`

## 4. Write tests for useRevertNote tags invalidation
- [ ] 4.1 Create test file `apps/web/src/api/__tests__/hooks.revert-tags.test.js` with test for useRevertNote
  - [ ] 4.1.1 ~PBT: Property 1~ Write property test: for any note slug, `useRevertNote.onSuccess` triggers `invalidateQueries` with `tagKeys.all`

## 5. Write preservation tests
- [ ] 5.1 ~PBT: Property 2~ Write property test: for any note slug, `confirmArchive` still invalidates `['notes']` after the fix
- [ ] 5.2 ~PBT: Property 2~ Write property test: for any note slug, `useRevertNote.onSuccess` still invalidates note detail, markdown, revisions, and activity log after the fix
- [ ] 5.3 Write unit test: verify `useCreateNote`, `useUpdateNote`, and `useArchiveNote` still invalidate `['tags']` (no regression)
