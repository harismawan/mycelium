import { expect } from 'bun:test';

export async function captureLoggerRecord({ script, env = {} }) {
  const child = Bun.spawn({
    cmd: ['bun', '-e', script],
    cwd: process.cwd(),
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
