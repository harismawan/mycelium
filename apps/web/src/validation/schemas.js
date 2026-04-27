/**
 * Centralized Zod validation schemas for Mycelium SPA forms.
 *
 * Provides schemas for login, registration, note creation/update,
 * and an async title-uniqueness check against the API.
 *
 * @module validation/schemas
 */

import { z } from 'zod';
import { apiGet } from '../api/client.js';

// ---------------------------------------------------------------------------
// Auth schemas
// ---------------------------------------------------------------------------

/** Schema for the login form. */
export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

/** Schema for the registration form. */
export const registerSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(1, 'Display name is required'),
});

// ---------------------------------------------------------------------------
// Note schemas
// ---------------------------------------------------------------------------

/** Schema for creating a new note. */
export const noteCreateSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  content: z.string(),
});

/** Schema for updating an existing note. All fields are optional. */
export const noteUpdateSchema = z.object({
  title: z.string().min(1, 'Title must not be empty').optional(),
  content: z.string().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  tags: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Title uniqueness check
// ---------------------------------------------------------------------------

/**
 * Check whether a note title is already taken by querying the API.
 *
 * Uses `GET /notes?q=<title>` and inspects the results for an exact
 * title match, excluding the note identified by `currentSlug` (useful
 * when editing an existing note).
 *
 * @param {string} title — the title to check
 * @param {string} [currentSlug] — slug of the note being edited (excluded from the duplicate check)
 * @returns {Promise<string | null>} error message if a duplicate exists, otherwise `null`
 */
export async function validateTitleUniqueness(title, currentSlug) {
  if (!title || !title.trim()) return null;

  try {
    const data = await apiGet(`/notes?q=${encodeURIComponent(title)}`);
    const notes = data.notes ?? data ?? [];

    const duplicate = notes.find(
      (/** @type {{ title: string, slug: string }} */ n) =>
        n.title.toLowerCase() === title.toLowerCase() &&
        n.slug !== currentSlug,
    );

    if (duplicate) {
      return `A note with the title "${duplicate.title}" already exists`;
    }

    return null;
  } catch {
    // If the API call fails, skip the uniqueness check rather than blocking the user
    return null;
  }
}
