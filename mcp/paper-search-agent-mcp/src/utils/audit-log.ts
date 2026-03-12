/**
 * Audit logger — append-only JSONL log for all retrieval attempts.
 * Each entry is an AccessAttempt with additional context.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { AccessAttempt } from "../schemas/index.js";

const DEFAULT_LOG_PATH = "./logs/audit.jsonl";

export function logAttempt(attempt: AccessAttempt, logPath: string = DEFAULT_LOG_PATH): void {
  const fullPath = resolve(logPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  appendFileSync(fullPath, JSON.stringify(attempt) + "\n", "utf-8");
}

export function logAttempts(attempts: AccessAttempt[], logPath: string = DEFAULT_LOG_PATH): void {
  for (const a of attempts) {
    logAttempt(a, logPath);
  }
}
