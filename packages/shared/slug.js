/**
 * Generate a URL-safe slug from a title string.
 *
 * Converts the title to lowercase, replaces spaces and special characters
 * with hyphens, removes non-alphanumeric characters (except hyphens),
 * collapses consecutive hyphens, and trims leading/trailing hyphens.
 *
 * @param {string} title - The title to slugify.
 * @returns {string} A URL-safe slug derived from the title.
 */
export function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Generate a unique slug from a title, appending a numeric suffix if needed.
 *
 * Calls {@link slugify} to produce the base slug, then checks against the
 * provided set of existing slugs. If the base slug is already taken, appends
 * `-1`, `-2`, etc. until a unique slug is found.
 *
 * @param {string} title - The title to derive the slug from.
 * @param {string[] | Set<string>} existingSlugs - Collection of slugs already in use.
 * @returns {string} A slug guaranteed to be unique within `existingSlugs`.
 */
export function uniqueSlug(title, existingSlugs) {
  const base = slugify(title);
  const slugSet = existingSlugs instanceof Set ? existingSlugs : new Set(existingSlugs);

  if (!slugSet.has(base)) {
    return base;
  }

  let counter = 1;
  while (slugSet.has(`${base}-${counter}`)) {
    counter++;
  }

  return `${base}-${counter}`;
}
