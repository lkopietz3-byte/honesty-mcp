import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Code execution is off by default in the shipped server. Most tests drive
    // the code-execution tools, so they run with it enabled; test/codeExec.test.ts
    // sets and clears the variable itself to cover the other cases.
    setupFiles: ['./test/setup-env.ts'],
    // Tests start worker threads and child processes; the 5 s default is too tight on a busy machine.
    testTimeout: 30_000,
  },
});
