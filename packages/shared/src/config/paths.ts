/**
 * Centralized path configuration for Craft Agent.
 *
 * Supports multi-instance development via CRAFT_CONFIG_DIR environment variable.
 * When running from a numbered folder (e.g., craft-tui-agent-1), the detect-instance.sh
 * script sets CRAFT_CONFIG_DIR to ~/.craft-agent-1, allowing multiple instances to run
 * simultaneously with separate configurations.
 *
 * Default (non-numbered folders): ~/.craft-agent/
 * Instance 1 (-1 suffix): ~/.craft-agent-1/
 * Instance 2 (-2 suffix): ~/.craft-agent-2/
 */

import { homedir } from 'os';
import { join, resolve } from 'path';

/**
 * Expand leading ~ to the user's home directory.
 * Node.js does not expand ~ in environment variables (unlike shell).
 */
function expandTilde(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
  return p;
}

// Allow override via environment variable for multi-instance dev
// Falls back to default ~/.craft-agent/ for production and non-numbered dev folders
// resolve() ensures the result is always an absolute path.
export const CONFIG_DIR = resolve(
  process.env.CRAFT_CONFIG_DIR
    ? expandTilde(process.env.CRAFT_CONFIG_DIR)
    : join(homedir(), '.craft-agent')
);
