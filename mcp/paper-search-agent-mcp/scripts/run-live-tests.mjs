import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const vitestBin = resolve(projectRoot, "node_modules", "vitest", "vitest.mjs");
const extraArgs = process.argv.slice(2);

const child = spawn(
  process.execPath,
  [vitestBin, "run", ...extraArgs],
  {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      RUN_LIVE_API_TESTS: "1",
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
