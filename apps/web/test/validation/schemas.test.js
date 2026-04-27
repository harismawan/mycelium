import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
  loginSchema,
  registerSchema,
  noteCreateSchema,
  noteUpdateSchema,
  validateTitleUniqueness,
} from '../../src/validation/schemas.js';

// ---------------------------------------------------------------------------
// loginSchema
// ---------------------------------------------------------------------------

describe('loginSchema', () => {
  test('accepts valid email and password', () => {
    const result = loginSchema.safeParse({ email: 'user@example.com', password: 'x' });
    expect(result.success).toBe(true);
  });

  test('rejects invalid email', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', password: 'x' });
    expect(result.success).toBe(false);
  });

  test('rejects empty password', () => {
    const result = loginSchema.safeParse({ email: 'user@example.com', password: '' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// registerSchema
// ---------------------------------------------------------------------------

describe('registerSchema', () => {
  test('accepts valid registration data', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'longpassword',
      displayName: 'Alice',
    });
    expect(result.success).toBe(true);
  });

  test('rejects password shorter than 8 chars', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'short',
      displayName: 'Alice',
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty displayName', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'longpassword',
      displayName: '',
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid email', () => {
    const result = registerSchema.safeParse({
      email: 'bad',
      password: 'longpassword',
      displayName: 'Alice',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// noteCreateSchema
// ---------------------------------------------------------------------------

describe('noteCreateSchema', () => {
  test('accepts valid title and content', () => {
    const result = noteCreateSchema.safeParse({ title: 'My Note', content: 'Hello world' });
    expect(result.success).toBe(true);
  });

  test('accepts empty content', () => {
    const result = noteCreateSchema.safeParse({ title: 'My Note', content: '' });
    expect(result.success).toBe(true);
  });

  test('rejects empty title', () => {
    const result = noteCreateSchema.safeParse({ title: '', content: 'body' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// noteUpdateSchema
// ---------------------------------------------------------------------------

describe('noteUpdateSchema', () => {
  test('accepts all fields', () => {
    const result = noteUpdateSchema.safeParse({
      title: 'Updated',
      content: 'new body',
      status: 'PUBLISHED',
      tags: ['a', 'b'],
    });
    expect(result.success).toBe(true);
  });

  test('accepts empty object (all optional)', () => {
    const result = noteUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test('rejects invalid status value', () => {
    const result = noteUpdateSchema.safeParse({ status: 'DELETED' });
    expect(result.success).toBe(false);
  });

  test('rejects empty title when provided', () => {
    const result = noteUpdateSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });

  test('accepts each valid status', () => {
    for (const s of ['DRAFT', 'PUBLISHED', 'ARCHIVED']) {
      const result = noteUpdateSchema.safeParse({ status: s });
      expect(result.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// validateTitleUniqueness
// ---------------------------------------------------------------------------

describe('validateTitleUniqueness', () => {
  test('returns null for empty title', async () => {
    const result = await validateTitleUniqueness('');
    expect(result).toBeNull();
  });

  test('returns null for whitespace-only title', async () => {
    const result = await validateTitleUniqueness('   ');
    expect(result).toBeNull();
  });

  test('returns null when API call fails (graceful degradation)', async () => {
    // validateTitleUniqueness catches errors and returns null
    // When there's no server running, the fetch will fail
    const result = await validateTitleUniqueness('Some Title');
    expect(result).toBeNull();
  });
});
