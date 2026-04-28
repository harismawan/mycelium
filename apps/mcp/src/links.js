/**
 * Shared link reconciliation helpers for MCP write tools.
 *
 * Replicated from apps/api/src/services/note.service.js to avoid
 * cross-app imports. Operates on a Prisma transaction client.
 *
 * @module links
 */

/**
 * Reconcile the Link table for a note after content changes.
 *
 * Diffs the current wikilinks in the content against existing Link records:
 * - Creates new Link records for newly added wikilinks
 * - Removes Link records for wikilinks no longer present
 *
 * For each wikilink, looks up the target note by title. If found, sets `toId`;
 * otherwise stores the unresolved title in `toTitle`.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} noteId
 * @param {string[]} wikilinks - Deduplicated wikilink titles extracted from content.
 * @param {string} userId
 */
export async function reconcileLinks(tx, noteId, wikilinks, userId) {
  const existingLinks = await tx.link.findMany({
    where: { fromId: noteId },
    select: { id: true, toTitle: true, toId: true },
  });

  // Resolve existing links that have toId to get their titles
  const resolvedIds = existingLinks.filter((l) => l.toId).map((l) => l.toId);
  const resolvedNotes = resolvedIds.length
    ? await tx.note.findMany({
        where: { id: { in: resolvedIds } },
        select: { id: true, title: true },
      })
    : [];
  const idToTitle = new Map(resolvedNotes.map((n) => [n.id, n.title]));

  // Build full set of existing link target titles
  const existingTargetTitles = new Set();
  for (const link of existingLinks) {
    if (link.toTitle) {
      existingTargetTitles.add(link.toTitle);
    } else if (link.toId) {
      const t = idToTitle.get(link.toId);
      if (t) existingTargetTitles.add(t);
    }
  }

  const currentSet = new Set(wikilinks);
  const toCreate = wikilinks.filter((t) => !existingTargetTitles.has(t));
  const toRemove = existingLinks.filter((link) => {
    const title = link.toTitle ?? idToTitle.get(link.toId);
    return title && !currentSet.has(title);
  });

  // Remove stale links
  if (toRemove.length) {
    await tx.link.deleteMany({
      where: { id: { in: toRemove.map((l) => l.id) } },
    });
  }

  // Create new links
  for (const title of toCreate) {
    const target = await tx.note.findFirst({
      where: { title, userId },
      select: { id: true },
    });

    await tx.link.create({
      data: {
        fromId: noteId,
        toId: target?.id ?? null,
        toTitle: target ? null : title,
      },
    });
  }
}

/**
 * Resolve any existing unresolved links whose `toTitle` matches the given title.
 *
 * Called after creating or updating a note so that previously dangling links
 * now point to the correct note.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} noteId
 * @param {string} title
 */
export async function resolveUnresolvedLinks(tx, noteId, title) {
  await tx.link.updateMany({
    where: {
      toId: null,
      toTitle: title,
    },
    data: {
      toId: noteId,
      toTitle: null,
    },
  });
}
