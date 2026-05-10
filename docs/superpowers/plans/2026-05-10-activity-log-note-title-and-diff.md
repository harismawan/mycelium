# Activity Log — Note Title & Update Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich activity log entries with the note's human-readable title for all CRUD events, and include a structured before/after diff for `note:update` events.

**Architecture:** Service methods `archiveNote` and `deleteNote` are updated to return the note title before acting. `updateNote` is updated to return both the updated note and a `before` snapshot captured from the already-fetched `existing` record. Route handlers use this data to build richer `details` objects. The frontend activity feed uses `details.noteTitle` as the link label.

**Tech Stack:** Bun, Elysia, Prisma, React (styled-components)

---

## File Map

| File | Change |
|------|--------|
| `apps/api/src/services/note.service.js` | `archiveNote` → return `{ id, title }`; `deleteNote` → return `{ title }`; `updateNote` → return `{ note, before }` |
| `apps/api/src/routes/notes.routes.js` | All `logAction` calls updated with `noteTitle` + `changes` diff |
| `apps/web/src/pages/ActivityFeedPage.jsx` | `summarizeDetails` + resource link text use `noteTitle` |
| `apps/api/test/services/note.service.test.js` | New tests for changed return values |

---

## Task 1: `archiveNote` — return note title

**Files:**
- Modify: `apps/api/src/services/note.service.js:299-312`
- Test: `apps/api/test/services/note.service.test.js`

- [ ] **Step 1: Write a failing test**

Add to `note.service.test.js` inside the existing `describe('NoteService.archiveNote', ...)` block (or create one if absent):

```js
describe('NoteService.archiveNote', () => {
  test('returns the archived note title', async () => {
    mockNote.findFirst.mockResolvedValue({ id: 'note_1', title: 'My Note' });
    mockNote.update.mockResolvedValue({ id: 'note_1', title: 'My Note', status: 'ARCHIVED' });

    const result = await NoteService.archiveNote('user_1', 'my-note');

    expect(result).toEqual({ id: 'note_1', title: 'My Note' });
  });

  test('throws 404 when note not found', async () => {
    mockNote.findFirst.mockResolvedValue(null);

    await expect(NoteService.archiveNote('user_1', 'ghost')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
cd /home/homebrew/code/mycelium
bun test apps/api/test/services/note.service.test.js --reporter=verbose 2>&1 | grep -A 3 "archiveNote"
```

Expected: test fails — `result` is `undefined`.

- [ ] **Step 3: Update `archiveNote` in note.service.js**

Current code at line ~299:
```js
async archiveNote(userId, slug) {
  const note = await prisma.note.findFirst({
    where: { slug, userId },
    select: { id: true },
  });
  if (!note) {
    throw { statusCode: 404, message: 'Note not found' };
  }

  await prisma.note.update({
    where: { id: note.id },
    data: { status: 'ARCHIVED' },
  });
},
```

Replace with:
```js
async archiveNote(userId, slug) {
  const note = await prisma.note.findFirst({
    where: { slug, userId },
    select: { id: true, title: true },
  });
  if (!note) {
    throw { statusCode: 404, message: 'Note not found' };
  }

  await prisma.note.update({
    where: { id: note.id },
    data: { status: 'ARCHIVED' },
  });

  return note;
},
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
bun test apps/api/test/services/note.service.test.js --reporter=verbose 2>&1 | grep -A 3 "archiveNote"
```

Expected: both archiveNote tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/note.service.js apps/api/test/services/note.service.test.js
git commit -m "feat(note-service): archiveNote returns note id and title"
```

---

## Task 2: `deleteNote` — return note title

**Files:**
- Modify: `apps/api/src/services/note.service.js:373-390`
- Test: `apps/api/test/services/note.service.test.js`

- [ ] **Step 1: Write a failing test**

Add to `note.service.test.js`:

```js
describe('NoteService.deleteNote', () => {
  test('returns the deleted note title', async () => {
    mockNote.findFirst.mockResolvedValue({ id: 'note_1', title: 'My Note' });
    // deleteMany and delete are called via $transaction array
    mockLink.deleteMany.mockResolvedValue({ count: 0 });

    const result = await NoteService.deleteNote('user_1', 'my-note');

    expect(result).toEqual({ title: 'My Note' });
  });

  test('throws 404 when note not found', async () => {
    mockNote.findFirst.mockResolvedValue(null);

    await expect(NoteService.deleteNote('user_1', 'ghost')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
bun test apps/api/test/services/note.service.test.js --reporter=verbose 2>&1 | grep -A 3 "deleteNote"
```

Expected: `result` is `undefined`.

- [ ] **Step 3: Update `deleteNote` in note.service.js**

Current code at line ~373:
```js
async deleteNote(userId, slug) {
  const note = await prisma.note.findFirst({
    where: { slug, userId },
    select: { id: true },
  });
  if (!note) {
    throw { statusCode: 404, message: 'Note not found' };
  }

  await prisma.$transaction([
    prisma.link.deleteMany({ where: { fromId: note.id } }),
    prisma.link.deleteMany({ where: { toId: note.id } }),
    prisma.revision.deleteMany({ where: { noteId: note.id } }),
    prisma.note.delete({ where: { id: note.id } }),
  ]);
},
```

Replace with:
```js
async deleteNote(userId, slug) {
  const note = await prisma.note.findFirst({
    where: { slug, userId },
    select: { id: true, title: true },
  });
  if (!note) {
    throw { statusCode: 404, message: 'Note not found' };
  }

  await prisma.$transaction([
    prisma.link.deleteMany({ where: { fromId: note.id } }),
    prisma.link.deleteMany({ where: { toId: note.id } }),
    prisma.revision.deleteMany({ where: { noteId: note.id } }),
    prisma.note.delete({ where: { id: note.id } }),
  ]);

  return { title: note.title };
},
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
bun test apps/api/test/services/note.service.test.js --reporter=verbose 2>&1 | grep -A 3 "deleteNote"
```

Expected: both deleteNote tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/note.service.js apps/api/test/services/note.service.test.js
git commit -m "feat(note-service): deleteNote returns deleted note title"
```

---

## Task 3: `updateNote` — return `{ note, before }` snapshot

**Files:**
- Modify: `apps/api/src/services/note.service.js:197-298`
- Test: `apps/api/test/services/note.service.test.js`

- [ ] **Step 1: Write a failing test**

`updateNote` is already tested. Add a new test that checks the return shape:

```js
describe('NoteService.updateNote — returns before snapshot', () => {
  test('returns { note, before } with pre-update field values', async () => {
    const existing = {
      id: 'note_1',
      slug: 'my-note',
      title: 'Old Title',
      content: 'Old content here',
      status: 'DRAFT',
      tags: [{ id: 'tag_1', name: 'old-tag' }],
    };
    mockNote.findFirst.mockResolvedValue(existing);
    mockNote.findMany.mockResolvedValue([]); // no slug collisions
    mockLink.findMany.mockResolvedValue([]);
    mockLink.updateMany.mockResolvedValue({ count: 0 });

    const updatedNote = {
      id: 'note_1',
      slug: 'new-title',
      title: 'New Title',
      content: 'New content here',
      status: 'PUBLISHED',
      tags: [{ id: 'tag_2', name: 'new-tag' }],
      revisions: [],
    };
    mockNote.update.mockResolvedValue(updatedNote);

    const result = await NoteService.updateNote('user_1', 'my-note', {
      title: 'New Title',
      content: 'New content here',
      status: 'PUBLISHED',
      tags: ['new-tag'],
    });

    expect(result).toHaveProperty('note');
    expect(result).toHaveProperty('before');
    expect(result.before.title).toBe('Old Title');
    expect(result.before.status).toBe('DRAFT');
    expect(result.before.tags).toEqual(['old-tag']);
    expect(result.before.content).toBe('Old content here');
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
bun test apps/api/test/services/note.service.test.js --reporter=verbose 2>&1 | grep -A 5 "returns before snapshot"
```

Expected: fail — `result.before` is undefined (currently returns bare `note`).

- [ ] **Step 3: Update `updateNote` in note.service.js**

In `updateNote`, after `existing` is fetched and before the update logic, capture the before snapshot. Then change the return value.

Find the line where `existing` is used and `tags` are read (around line 198-210). After `const { authType, apiKeyId, apiKeyName } = data;`, add:

```js
const before = {
  title: existing.title,
  status: existing.status,
  tags: existing.tags.map((t) => t.name),
  content: existing.content,
};
```

Then find the final `return` at the end of `updateNote` (currently `return note;` after the transaction) and change it to:

```js
return { note, before };
```

The full function tail (after the transaction block) becomes:
```js
    // ... (transaction block unchanged)

    return { note, before };
  },
```

- [ ] **Step 4: Run all note service tests**

```bash
bun test apps/api/test/services/note.service.test.js --reporter=verbose
```

Expected: new test passes. Existing `updateNote` tests that do `const result = await NoteService.updateNote(...)` and then check `result.id` / `result.title` / `result.slug` directly will now fail because `result` is `{ note, before }`. Fix each broken test by changing `const result =` to `const { note: result } =` (or destructure to `note` and adjust assertions accordingly).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/note.service.js apps/api/test/services/note.service.test.js
git commit -m "feat(note-service): updateNote returns { note, before } for diff logging"
```

---

## Task 4: Update routes — enrich all logAction details

**Files:**
- Modify: `apps/api/src/routes/notes.routes.js`

No new test file needed — the route changes are thin wrappers around service data already tested. The route is updated in one commit.

- [ ] **Step 1: Update `note:create` logAction (rename `title` → `noteTitle`)**

Find the `note:create` logAction block (around line 49-58):

```js
// BEFORE
details: { title: ctx.body.title },

// AFTER
details: { noteTitle: ctx.body.title },
```

- [ ] **Step 2: Update `note:update` handler**

The current handler (around line 234-253):
```js
const note = await NoteService.updateNote(ctx.user.id, ctx.params.slug, { ... });

if (ctx.authType === 'apikey') {
  await ActivityLogService.logAction({
    ...
    details: { fields: Object.keys(ctx.body) },
    ...
  });
}

return note;
```

Replace with:
```js
const { note, before } = await NoteService.updateNote(ctx.user.id, ctx.params.slug, {
  ...ctx.body,
  authType: ctx.authType,
  apiKeyId: ctx.apiKeyId,
  apiKeyName: ctx.apiKeyName,
});

if (ctx.authType === 'apikey') {
  const changes = {};
  if (ctx.body.title !== undefined && ctx.body.title !== before.title) {
    changes.title = { from: before.title, to: note.title };
  }
  if (ctx.body.status !== undefined && ctx.body.status !== before.status) {
    changes.status = { from: before.status, to: note.status };
  }
  if (ctx.body.tags !== undefined) {
    const fromTags = [...before.tags].sort();
    const toTags = note.tags.map((t) => t.name).sort();
    if (JSON.stringify(fromTags) !== JSON.stringify(toTags)) {
      changes.tags = { from: fromTags, to: toTags };
    }
  }
  if (ctx.body.content !== undefined) {
    changes.content = { charsBefore: before.content.length, charsAfter: note.content.length };
  }

  await ActivityLogService.logAction({
    userId: ctx.user.id,
    apiKeyId: ctx.apiKeyId,
    apiKeyName: ctx.apiKeyName,
    action: 'note:update',
    targetResourceId: note.id,
    targetResourceSlug: note.slug,
    details: { noteTitle: note.title, changes },
    status: 'success',
  });
}

return note;
```

- [ ] **Step 3: Update `note:archive` handler**

Current (around line 293-308):
```js
await NoteService.archiveNote(ctx.user.id, ctx.params.slug);

if (ctx.authType === 'apikey') {
  await ActivityLogService.logAction({
    ...
    details: {},
    ...
  });
}
```

Replace with:
```js
const archivedNote = await NoteService.archiveNote(ctx.user.id, ctx.params.slug);

if (ctx.authType === 'apikey') {
  await ActivityLogService.logAction({
    userId: ctx.user.id,
    apiKeyId: ctx.apiKeyId,
    apiKeyName: ctx.apiKeyName,
    action: 'note:archive',
    targetResourceId: archivedNote.id,
    targetResourceSlug: ctx.params.slug,
    details: { noteTitle: archivedNote.title },
    status: 'success',
  });
}

return { message: 'Note archived' };
```

- [ ] **Step 4: Update `note:delete` handler**

Current (around line 331-345):
```js
await NoteService.deleteNote(ctx.user.id, ctx.params.slug);

if (ctx.authType === 'apikey') {
  await ActivityLogService.logAction({
    ...
    details: {},
    ...
  });
}
```

Replace with:
```js
const deletedNote = await NoteService.deleteNote(ctx.user.id, ctx.params.slug);

if (ctx.authType === 'apikey') {
  await ActivityLogService.logAction({
    userId: ctx.user.id,
    apiKeyId: ctx.apiKeyId,
    apiKeyName: ctx.apiKeyName,
    action: 'note:delete',
    targetResourceId: null,
    targetResourceSlug: ctx.params.slug,
    details: { noteTitle: deletedNote.title },
    status: 'success',
  });
}

return { message: 'Note deleted permanently' };
```

- [ ] **Step 5: Update `note:revert` handler**

Current logAction details (around line 385-393):
```js
details: { revisionId: ctx.body.revisionId },
```

Replace with:
```js
details: { noteTitle: note.title, revisionId: ctx.body.revisionId },
```

- [ ] **Step 6: Run all API tests**

```bash
bun test apps/api/test/ --reporter=verbose
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/notes.routes.js
git commit -m "feat(notes-routes): enrich activity log with noteTitle and update diff"
```

---

## Task 5: Frontend — display note title in activity feed

**Files:**
- Modify: `apps/web/src/pages/ActivityFeedPage.jsx`

- [ ] **Step 1: Update `summarizeDetails` to use `noteTitle`**

Find the current `summarizeDetails` function (around line 300-309):

```js
function summarizeDetails(details) {
  if (!details || typeof details !== 'object') return null;
  const parts = [];
  if (details.title) parts.push(`"${details.title}"`);
  if (details.message) parts.push(details.message);
  if (details.error) parts.push(`Error: ${details.error}`);
  if (details.query) parts.push(`Query: "${details.query}"`);
  if (details.revisionId) parts.push(`Revision: ${details.revisionId}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}
```

Replace with:
```js
function summarizeDetails(details) {
  if (!details || typeof details !== 'object') return null;
  const parts = [];
  // noteTitle is the canonical field; title is kept for backward compat with old log entries
  if (details.noteTitle) parts.push(`"${details.noteTitle}"`);
  else if (details.title) parts.push(`"${details.title}"`);
  if (details.message) parts.push(details.message);
  if (details.error) parts.push(`Error: ${details.error}`);
  if (details.query) parts.push(`Query: "${details.query}"`);
  if (details.revisionId) parts.push(`Revision: ${details.revisionId}`);
  if (details.changes && Object.keys(details.changes).length > 0) {
    parts.push(`Changed: ${Object.keys(details.changes).join(', ')}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
```

- [ ] **Step 2: Update resource link to show note title as link text**

Find the resource link block (around line 446-453):
```jsx
{entry.targetResourceSlug && (
  <ResourceLink to={`/notes/${entry.targetResourceSlug}`}>
    {entry.targetResourceSlug}
  </ResourceLink>
)}
```

Replace with:
```jsx
{entry.targetResourceSlug && (
  <ResourceLink to={`/notes/${entry.targetResourceSlug}`}>
    {entry.details?.noteTitle || entry.targetResourceSlug}
  </ResourceLink>
)}
```

- [ ] **Step 3: Run web tests**

```bash
bun test apps/web/test/ --reporter=verbose
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ActivityFeedPage.jsx
git commit -m "feat(activity-feed): show note title as link text, surface changed fields in summary"
```

---

## Task 6: Push branch

- [ ] **Push to remote**

```bash
git push -u origin feat/activity-log-note-title-and-diff
```
