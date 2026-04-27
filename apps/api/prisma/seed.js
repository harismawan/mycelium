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
    title: 'Getting Started with Mycelium',
    slug: 'getting-started-with-mycelium',
    status: 'PUBLISHED',
    tags: ['guide', 'onboarding'],
    content: `Welcome to Mycelium, your second brain. This note will help you understand the basics.

Check out [[How Wikilinks Work]] to learn about linking notes together.
Also see [[Markdown Tips]] for formatting guidance.`,
  },
  {
    title: 'How Wikilinks Work',
    slug: 'how-wikilinks-work',
    status: 'PUBLISHED',
    tags: ['guide', 'linking'],
    content: `Wikilinks let you connect notes using the \`[[Note Title]]\` syntax.

For example, linking to [[Getting Started with Mycelium]] creates a bidirectional relationship.
You can also link to [[Graph Visualization Guide]] to see how links appear visually.
See [[Backlinks Explained]] for the reverse side of linking.`,
  },
  {
    title: 'Backlinks Explained',
    slug: 'backlinks-explained',
    status: 'PUBLISHED',
    tags: ['guide', 'linking'],
    content: `# Backlinks Explained

Backlinks are the reverse of wikilinks. When [[How Wikilinks Work]] links to this note,
this note automatically shows that as a backlink.

Backlinks help you discover connections you might not have made explicitly.
Related: [[Knowledge Graph Theory]].`,
  },
  {
    title: 'Markdown Tips',
    slug: 'markdown-tips',
    status: 'PUBLISHED',
    tags: ['guide', 'writing'],
    content: `# Markdown Tips

Mycelium stores everything as Markdown with YAML frontmatter.

- Use headings for structure
- Use lists for organization
- Use code blocks for technical content

See [[Getting Started with Mycelium]] for the basics and [[Daily Note Template]] for a practical example.`,
  },
  {
    title: 'Daily Note Template',
    slug: 'daily-note-template',
    status: 'DRAFT',
    tags: ['template', 'productivity'],
    content: `# Daily Note Template

Use this template for your daily notes:

## Tasks
- [ ] Review [[Project Alpha Notes]]
- [ ] Update [[Research on Neural Networks]]

## Reflections
Write your thoughts here. Link to relevant notes using wikilinks.`,
  },
  {
    title: 'Project Alpha Notes',
    slug: 'project-alpha-notes',
    status: 'PUBLISHED',
    tags: ['project', 'work'],
    content: `# Project Alpha Notes

Key decisions and progress for Project Alpha.

## Architecture
We decided to use a microservices approach. See [[API Design Patterns]] for reference.

## Timeline
- Phase 1: Research — see [[Research on Neural Networks]]
- Phase 2: Implementation
- Phase 3: Testing`,
  },
  {
    title: 'Research on Neural Networks',
    slug: 'research-on-neural-networks',
    status: 'PUBLISHED',
    tags: ['research', 'ai'],
    content: `# Research on Neural Networks

Notes on neural network architectures and training approaches.

## Key Papers
- Attention Is All You Need
- BERT: Pre-training of Deep Bidirectional Transformers

## Connections
This research feeds into [[Project Alpha Notes]] and relates to [[Knowledge Graph Theory]].`,
  },
  {
    title: 'Knowledge Graph Theory',
    slug: 'knowledge-graph-theory',
    status: 'PUBLISHED',
    tags: ['research', 'linking'],
    content: `# Knowledge Graph Theory

Knowledge graphs represent information as nodes and edges, similar to how Mycelium works.

## Core Concepts
- Nodes represent entities (notes in our case)
- Edges represent relationships (wikilinks)
- Traversal enables discovery

See [[Graph Visualization Guide]] for how Mycelium renders these.
Also related: [[Backlinks Explained]] and [[How Wikilinks Work]].`,
  },
  {
    title: 'Graph Visualization Guide',
    slug: 'graph-visualization-guide',
    status: 'PUBLISHED',
    tags: ['guide', 'visualization'],
    content: `# Graph Visualization Guide

Mycelium provides an interactive graph view of your notes and their connections.

## Features
- Force-directed layout
- Color-coded by status
- Click to navigate
- Zoom and pan

The graph is built from the links described in [[How Wikilinks Work]] and grounded in [[Knowledge Graph Theory]].`,
  },
  {
    title: 'API Design Patterns',
    slug: 'api-design-patterns',
    status: 'DRAFT',
    tags: ['engineering', 'reference'],
    content: `# API Design Patterns

Common patterns used in [[Project Alpha Notes]] and other projects.

## REST Conventions
- Use nouns for resources
- Use HTTP verbs for actions
- Cursor-based pagination for lists

## Authentication
- JWT for human users
- API keys for agents

See [[Getting Started with Mycelium]] for how Mycelium implements these patterns.`,
  },
  {
    title: 'Archived Meeting Notes',
    slug: 'archived-meeting-notes',
    status: 'ARCHIVED',
    tags: ['meetings', 'work'],
    content: `# Archived Meeting Notes

These meeting notes from Q1 are no longer active.

## Discussed
- [[Project Alpha Notes]] timeline review
- [[Research on Neural Networks]] progress update

This note has been archived but links are preserved.`,
  },
  {
    title: 'Personal Reading List',
    slug: 'personal-reading-list',
    status: 'DRAFT',
    tags: ['personal', 'reading'],
    content: `# Personal Reading List

Books and articles to read:

1. Thinking in Systems — relates to [[Knowledge Graph Theory]]
2. The Art of Doing Science — connects to [[Research on Neural Networks]]
3. Design Patterns — see [[API Design Patterns]]

Use [[Daily Note Template]] to track reading progress.`,
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
