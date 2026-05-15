// ──────────────────────────────────────────────
// Shared Logger — Pino singleton
// ──────────────────────────────────────────────
// Every module in the server package should import `logger` from here
// instead of using `console.log/warn/error` directly. This ensures
// LOG_LEVEL actually controls what gets printed.
//
// The Fastify app reuses this same instance so request-scoped child
// loggers (req.log / reply.log) inherit the same level and transport.
// ──────────────────────────────────────────────
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import pino from "pino";
import { getLogLevel, getNodeEnv } from "../config/runtime-config.js";

function resolveServerLogFile() {
  const raw = process.env.SERVER_LOG_FILE?.trim();
  if (!raw) return null;
  const filePath = resolve(process.cwd(), raw);
  mkdirSync(dirname(filePath), { recursive: true });
  return filePath;
}

export function createLoggerOptions(): pino.LoggerOptions {
  const level = getLogLevel();
  const serverLogFile = resolveServerLogFile();
  const prettyConsole = getNodeEnv() !== "production";

  if (prettyConsole && serverLogFile) {
    return {
      level,
      transport: {
        targets: [
          {
            target: "pino-pretty",
            level,
            options: { colorize: true },
          },
          {
            target: "pino-pretty",
            level,
            options: { colorize: false, destination: serverLogFile },
          },
        ],
      },
    };
  }

  if (prettyConsole) {
    return {
      level,
      transport: { target: "pino-pretty", options: { colorize: true } },
    };
  }

  if (serverLogFile) {
    return {
      level,
      transport: {
        targets: [
          { target: "pino/file", level, options: { destination: 1 } },
          { target: "pino/file", level, options: { destination: serverLogFile, mkdir: true } },
        ],
      },
    };
  }

  return { level };
}

export const logger = pino(createLoggerOptions());

export function logDebugOverride(overrideEnabled: boolean, message: string, ...args: any[]) {
  if (overrideEnabled && !logger.isLevelEnabled("debug")) {
    // Default LOG_LEVEL is warn, so explicit UI debug mode must log at warn to be visible.
    logger.warn(message, ...args);
    return;
  }

  logger.debug(message, ...args);
}
