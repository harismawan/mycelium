import { afterEach, describe, expect, test } from 'bun:test';

import { log } from '../src/logger.js';

const originalError = console.error;
const originalLog = console.log;

afterEach(() => {
  console.error = originalError;
  console.log = originalLog;
});

describe('mcp logger', () => {
  test('writes structured diagnostics to stderr with service context', () => {
    const stderr = [];
    const stdout = [];
    console.error = (line) => stderr.push(line);
    console.log = (line) => stdout.push(line);

    log('info', 'tool.call', { tool: 'search_notes', success: true });

    expect(stdout).toEqual([]);
    expect(stderr).toHaveLength(1);

    const record = JSON.parse(stderr[0]);
    expect(record).toMatchObject({
      level: 'info',
      message: 'tool.call',
      tool: 'search_notes',
      success: true,
      'service.name': 'mycelium-mcp',
    });
    expect(record.timestamp).toBeString();
  });
});
