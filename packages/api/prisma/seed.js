// @ts-check
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

/** @param {string} key */
function hashApiKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

const DEMO_EMAIL = 'demo@mycelium.local';
const DEMO_PASSWORD = 'mycelium123';
const DEMO_DISPLAY_NAME = 'Demo User';
const DEMO_API_KEY_PLAINTEXT = 'myc_demo_agent_key_for_testing';

/**
 * Seed notes — 12 interlinked notes with varied statuses, tags, and wikilinks.
 * @type {Array<{ title: string, slug: string, status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED', tags: string[], content: string }>}
 */
const SEED_NOTES = [
  {
    title: 'Welcome to Mycelium',
    slug: 'welcome-to-mycelium',
    status: 'PUBLISHED',
    tags: ['getting-started'],
    content: `# Welcome to Mycelium

Mycelium is a knowledge network built for humans and AI agents. Think of it as a living notebook where every note can link to every other note, forming a web of ideas you can explore, search, and grow over time.

## What makes Mycelium different?

- A block-based editor that feels natural to write in — see [[The Block Editor]]
- Bidirectional links between notes using \`[[wikilinks]]\` — see [[Wikilinks and Backlinks]]
- An interactive graph that visualizes your knowledge — see [[The Graph View]]
- A REST API so AI agents can read and work with your notes — see [[Agent API]]

## Getting oriented

Start by exploring these notes. They cover everything from [[Tags and Organization]] to [[The Command Palette]] and [[Keyboard Shortcuts]]. Each one is a real Mycelium note, so feel free to edit, link, or delete them as you make the space your own.`,
  },
  {
    title: 'The Block Editor',
    slug: 'the-block-editor',
    status: 'PUBLISHED',
    tags: ['getting-started', 'editor'],
    content: `# The Block Editor

Mycelium uses a block-based editor. Each paragraph, heading, list, or code block is its own block that you can move and rearrange.

## Slash commands

Type \`/\` at the start of a new line to open the slash menu. From there you can insert:

- Headings (levels 1–3)
- Bullet and numbered lists
- Code blocks with syntax highlighting
- Blockquotes
- Images

## Editing tips

- Drag blocks by their handle to reorder content
- Press **Cmd+S** (or Ctrl+S) to save your note
- Switch to raw markdown anytime with [[Code View]]

The editor stores everything as clean markdown under the hood, so your notes are always portable. For a full list of shortcuts, see [[Keyboard Shortcuts]].`,
  },
  {
    title: 'Wikilinks and Backlinks',
    slug: 'wikilinks-and-backlinks',
    status: 'PUBLISHED',
    tags: ['getting-started', 'linking'],
    content: `# Wikilinks and Backlinks

Wikilinks are the connective tissue of Mycelium. They turn your notes from isolated pages into a connected knowledge network.

## Creating a wikilink

Type \`[\` in the editor and an autocomplete menu will appear with your existing notes. Select one to insert a \`[[wikilink]]\`. You can also type the full syntax manually: \`[[Note Title]]\`.

## Backlinks

When note A links to note B, note B automatically shows a backlink to note A in the right panel. You never have to create backlinks yourself — Mycelium tracks them for you.

## Why this matters

Backlinks surface unexpected connections. You might link to a note today and discover months later that five other notes also reference it. That's the power of a networked notebook.

To see how your links look as a whole, check out [[The Graph View]].`,
  },
  {
    title: 'The Graph View',
    slug: 'the-graph-view',
    status: 'PUBLISHED',
    tags: ['getting-started', 'visualization'],
    content: `# The Graph View

The graph view gives you a bird's-eye view of your entire knowledge network. Open it from the sidebar by clicking the graph icon.

## How it works

- Each note is a **node** in the graph
- Each [[Wikilinks and Backlinks]] connection is an **edge** between nodes
- Nodes are colored by status: published, draft, or archived (see [[Note Statuses]])

## Interacting with the graph

- Click any node to navigate directly to that note
- Zoom and pan to explore clusters of related ideas
- Hover over a node to highlight its connections

The graph is most useful once you have a handful of linked notes. As your network grows, you'll start to see clusters form around topics — that's your knowledge taking shape.`,
  },
  {
    title: 'Tags and Organization',
    slug: 'tags-and-organization',
    status: 'PUBLISHED',
    tags: ['getting-started', 'organization'],
    content: `# Tags and Organization

Tags give you a second way to organize notes alongside [[Wikilinks and Backlinks]]. While wikilinks capture relationships between specific ideas, tags group notes by broad topic.

## Adding tags

Open the **Properties** panel on the right side of the editor and add or remove tags from there. Tags are shared across all your notes, so reusing the same tag name groups notes together automatically.

## Browsing by tag

The sidebar has a tag tree that shows all your tags. Click any tag to filter the note list down to just the notes with that tag.

## Tips

- Use a small number of consistent tags rather than creating a new tag for every note
- Combine tags with wikilinks for the best of both worlds
- Tags like \`getting-started\` on these notes are a good example of topical grouping`,
  },
  {
    title: 'Note Statuses',
    slug: 'note-statuses',
    status: 'PUBLISHED',
    tags: ['getting-started', 'organization'],
    content: `# Note Statuses

Every note in Mycelium has one of three statuses:

- **DRAFT** — A work in progress. Draft notes are visible only to you and won't appear in agent API bundles. See [[Keyboard Shortcuts]] for an example of a draft note.
- **PUBLISHED** — Ready to share. Published notes are included in API responses and are the default status for new notes.
- **ARCHIVED** — No longer active but preserved for reference. See [[Example: Project Notes]] for an archived note.

## Changing status

Open the **Properties** panel on the right side of the editor and select a new status from the dropdown.

## Archive vs. delete

Archiving keeps the note and all its links intact — you can always restore it later. Deleting a note is permanent and removes it from the graph entirely. When in doubt, archive.`,
  },
  {
    title: 'The Command Palette',
    slug: 'the-command-palette',
    status: 'PUBLISHED',
    tags: ['getting-started', 'productivity'],
    content: `# The Command Palette

Press **Cmd+K** (or **Ctrl+K** on Windows/Linux) to open the command palette. It's the fastest way to get around Mycelium.

## What you can do

- **Search notes** — Start typing a note title to jump to it instantly
- **Navigate** — Go to the Graph view, Settings, or other pages
- **Quick actions** — Create a new note without leaving the keyboard

## Keyboard-first workflow

The command palette is designed for people who prefer to keep their hands on the keyboard. Combined with [[Keyboard Shortcuts]], you can navigate, create, and edit notes without ever reaching for the mouse.

If you're coming from tools like VS Code or Obsidian, this will feel familiar.`,
  },
  {
    title: 'Revision History',
    slug: 'revision-history',
    status: 'PUBLISHED',
    tags: ['getting-started', 'editor'],
    content: `# Revision History

Every time you save a note, Mycelium creates a revision. This means you can always look back at how a note evolved over time.

## Viewing revisions

Open the **Properties** panel and scroll to the revision history section. Each revision shows a timestamp and a summary. Click any revision to see a side-by-side diff comparing it to the current version.

## Why it matters

- Accidentally deleted a paragraph? Find it in a previous revision.
- Want to see how an idea developed? Walk through the history.
- Working with an AI agent via the [[Agent API]]? Revisions track every change, whether made by you or an agent.

Revisions are automatic — there's nothing to configure. Just save your work with **Cmd+S** and Mycelium handles the rest.`,
  },
  {
    title: 'Code View',
    slug: 'code-view',
    status: 'PUBLISHED',
    tags: ['getting-started', 'editor'],
    content: `# Code View

Mycelium stores every note as plain markdown. The code view lets you see and edit that markdown directly.

## Toggling code view

Click the code icon (\`</>\`) in the editor toolbar to switch between the block editor and raw markdown. Your changes sync between both views.

## When to use it

- Fixing formatting issues that are tricky in the block editor
- Pasting markdown from another tool
- Inspecting how [[Wikilinks and Backlinks]] look in the raw source (\`[[Note Title]]\`)
- Writing complex tables or nested lists

## Good to know

Code view shows exactly what gets stored. There's no hidden formatting or proprietary syntax — it's all standard markdown. This makes it easy to export your notes or work with them through the [[Agent API]].`,
  },
  {
    title: 'Agent API',
    slug: 'agent-api',
    status: 'PUBLISHED',
    tags: ['getting-started', 'api'],
    content: `# Agent API

Mycelium includes a REST API designed for AI agents. This lets external tools and LLMs read your notes, discover connections, and work with your knowledge base programmatically.

## Setting up

1. Go to **Settings** (from the sidebar or [[The Command Palette]])
2. Create a new API key and copy it somewhere safe
3. Use the key in the \`Authorization\` header as a Bearer token

## Key endpoints

- **Manifest** — Returns metadata about your knowledge base (note count, tags, etc.)
- **Bundle** — Streams all published notes as NDJSON, ideal for feeding into an LLM context
- **Notes** — CRUD operations on individual notes

## How agents use it

An AI agent can fetch your published notes via the bundle endpoint, process them, and even create new notes or update existing ones. Combined with [[Wikilinks and Backlinks]], agents can navigate your knowledge graph just like you do.

For more on how Mycelium works, head back to [[Welcome to Mycelium]].`,
  },
  {
    title: 'Keyboard Shortcuts',
    slug: 'keyboard-shortcuts',
    status: 'DRAFT',
    tags: ['getting-started', 'productivity'],
    content: `# Keyboard Shortcuts

A quick reference for the most useful shortcuts in Mycelium. This note is a **draft** — notice how it looks different in the sidebar and [[The Graph View]].

## Editor

| Shortcut | Action |
|----------|--------|
| \`Cmd+S\` | Save the current note |
| \`/\` | Open the slash command menu |
| \`[\` | Start a wikilink and open autocomplete |

## Navigation

| Shortcut | Action |
|----------|--------|
| \`Cmd+K\` | Open [[The Command Palette]] |

## Tips

- On Windows and Linux, replace \`Cmd\` with \`Ctrl\`
- The slash menu and wikilink autocomplete work inside [[The Block Editor]]
- Save often — every save creates a snapshot in [[Revision History]]`,
  },
  {
    title: 'Example: Project Notes',
    slug: 'example-project-notes',
    status: 'ARCHIVED',
    tags: ['example'],
    content: `# Example: Project Notes

This is a sample archived note. It demonstrates what happens when you archive something in Mycelium.

## What you'll notice

- This note still appears in search and in [[The Graph View]], but it's visually marked as archived
- All wikilinks to and from this note still work
- You can restore it to draft or published status anytime from the Properties panel

## Why archive?

Archiving is useful for notes that are no longer active but might be valuable later — old project plans, completed research, or meeting notes you want to keep around. See [[Note Statuses]] for more on how statuses work.

If you're just getting started, head over to [[Welcome to Mycelium]] for the full tour.`,
  },
];

async function seed() {
  console.log('🍄 Seeding Mycelium database...');

  // 1. Upsert demo user (idempotent)
  const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { displayName: DEMO_DISPLAY_NAME, password: hashedPassword },
    create: { email: DEMO_EMAIL, password: hashedPassword, displayName: DEMO_DISPLAY_NAME },
  });
  console.log(`  ✓ Demo user: ${user.email} (${user.id})`);

  // 2. Clean existing data for this user (idempotent re-seed)
  //    Delete links first (FK constraints), then revisions, notes, tags, api keys
  const existingNotes = await prisma.note.findMany({
    where: { userId: user.id },
    select: { id: true },
  });
  const noteIds = existingNotes.map((n) => n.id);

  if (noteIds.length > 0) {
    await prisma.link.deleteMany({ where: { fromId: { in: noteIds } } });
    await prisma.link.deleteMany({ where: { toId: { in: noteIds } } });
    await prisma.revision.deleteMany({ where: { noteId: { in: noteIds } } });
  }
  await prisma.note.deleteMany({ where: { userId: user.id } });
  await prisma.apiKey.deleteMany({ where: { userId: user.id } });
  console.log('  ✓ Cleaned existing seed data');

  // 3. Collect all unique tag names and upsert them
  const allTagNames = [...new Set(SEED_NOTES.flatMap((n) => n.tags))];
  const tagMap = /** @type {Record<string, string>} */ ({});
  for (const name of allTagNames) {
    const tag = await prisma.tag.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    tagMap[name] = tag.id;
  }
  console.log(`  ✓ Upserted ${allTagNames.length} tags`);

  // 4. Create notes with tags and revisions
  /** @type {Record<string, string>} slug -> noteId */
  const noteIdMap = {};
  /** @type {Record<string, string>} title -> noteId */
  const titleMap = {};

  for (const seedNote of SEED_NOTES) {
    const body = seedNote.content;
    const excerpt = body
      .replace(/#+\s*/g, '')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\n+/g, ' ')
      .trim()
      .slice(0, 200);

    const note = await prisma.note.create({
      data: {
        title: seedNote.title,
        slug: seedNote.slug,
        content: body,
        status: seedNote.status,
        excerpt,
        userId: user.id,
        tags: {
          connect: seedNote.tags.map((t) => ({ id: tagMap[t] })),
        },
        revisions: {
          create: {
            content: body,
            message: 'Initial seed',
          },
        },
      },
    });
    noteIdMap[note.slug] = note.id;
    titleMap[note.title] = note.id;
  }
  console.log(`  ✓ Created ${SEED_NOTES.length} notes with revisions`);

  // 5. Create links from wikilinks
  const wikilinkRegex = /\[\[([^\]]+)\]\]/g;
  let linkCount = 0;

  for (const seedNote of SEED_NOTES) {
    const fromId = noteIdMap[seedNote.slug];
    const matches = [...seedNote.content.matchAll(wikilinkRegex)];
    const seen = new Set();

    for (const match of matches) {
      const targetTitle = match[1];
      if (seen.has(targetTitle)) continue;
      seen.add(targetTitle);

      const toId = titleMap[targetTitle] || null;
      await prisma.link.create({
        data: {
          fromId,
          toId,
          toTitle: targetTitle,
        },
      });
      linkCount++;
    }
  }
  console.log(`  ✓ Created ${linkCount} wikilinks`);

  // 6. Create demo API key
  const keyHash = hashApiKey(DEMO_API_KEY_PLAINTEXT);
  await prisma.apiKey.create({
    data: {
      name: 'Demo Agent Key',
      keyHash,
      scopes: ['notes:read', 'agent:read'],
      userId: user.id,
    },
  });
  console.log(`  ✓ Created API key (plaintext: ${DEMO_API_KEY_PLAINTEXT})`);

  console.log('\n🍄 Seed complete!');
  console.log(`   Email:    ${DEMO_EMAIL}`);
  console.log(`   Password: ${DEMO_PASSWORD}`);
  console.log(`   API Key:  ${DEMO_API_KEY_PLAINTEXT}`);
}

seed()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
