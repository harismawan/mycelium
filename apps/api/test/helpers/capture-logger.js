import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'bun:test';

// apps/api root — the embedded scripts import './src/...' relative to it, so the
// spawn cwd must be apps/api regardless of where the test runner was invoked
// (CI runs `bun test` from the repo root, not `--cwd apps/api`).
const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export async function captureLoggerRecord({ script, env = {} }) {
  const child = Bun.spawn({
    cmd: ['bun', '-e', script],
    cwd: API_ROOT,
    env: {
      ...process.env,
      LOG_BODY: 'false',
      NODE_ENV: 'test',
      ...env,
    },
    stderr: 'pipe',
    stdout: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  expect(exitCode, stderr).toBe(0);

  const records = stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  return {
    records,
    logEntry: records.find((record) => record.msg === 'http'),
    stdout,
    stderr,
  };
}
