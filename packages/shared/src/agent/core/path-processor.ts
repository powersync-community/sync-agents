/**
 * PathProcessor - Path Expansion and Normalization
 *
 * Provides path utilities that both ClaudeAgent and CodexAgent can use.
 * Wraps the existing path utilities with a consistent interface for agent
 * tool processing.
 *
 * Key responsibilities:
 * - Expand ~ and $HOME to absolute paths
 * - Normalize paths for cross-platform comparison
 * - Detect config file paths that need validation
 */

import { homedir } from 'os';
import { resolve, isAbsolute, normalize as normalizePosix, basename, dirname } from 'path';
import { CONFIG_DIR } from '../../config/paths.ts';
import {
  expandPath,
  normalizePath,
  normalizePathForComparison,
  pathStartsWith,
  toPortablePath,
} from '../../utils/paths.ts';
import type { PathProcessorConfig } from './types.ts';

// Re-export useful utilities from paths.ts
export { expandPath, normalizePath, pathStartsWith, toPortablePath };

/**
 * Escape a string for use in a regular expression.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Known configuration file patterns that may need validation before writing.
 * Built lazily from CONFIG_DIR so tests can override CRAFT_CONFIG_DIR before first access.
 */
let _configFilePatterns: RegExp[] | null = null;

function getConfigFilePatterns(): RegExp[] {
  if (!_configFilePatterns) {
    const normalizedConfigDir = process.platform === 'win32'
      ? CONFIG_DIR.replace(/\\/g, '/').toLowerCase()
      : CONFIG_DIR.replace(/\\/g, '/');
    const escaped = escapeRegExp(normalizedConfigDir);
    _configFilePatterns = [
      // Craft Agent configs
      new RegExp(`${escaped}/.*/(config|permissions|theme|guide|labels|statuses)\\.json$`),
      new RegExp(`${escaped}/config\\.json$`),
      new RegExp(`${escaped}/preferences\\.json$`),
      new RegExp(`${escaped}/.*/SKILL\\.md$`),
      // Common config files
      /package\.json$/,
      /tsconfig\.json$/,
      /\.eslintrc(\.json)?$/,
      /\.prettierrc(\.json)?$/,
      /pyproject\.toml$/,
      /Cargo\.toml$/,
      /\.env(\..+)?$/,
    ];
  }
  return _configFilePatterns;
}

/** Reset cached patterns (for testing with different CRAFT_CONFIG_DIR values). */
export function resetConfigFilePatterns(): void {
  _configFilePatterns = null;
}

/**
 * PathProcessor provides path utilities for agent tool processing.
 *
 * Usage:
 * ```typescript
 * const pathProcessor = new PathProcessor();
 *
 * // Expand user paths in tool inputs
 * const expandedPath = pathProcessor.expandPath('~/Documents/file.txt');
 *
 * // Check if a file needs config validation
 * if (pathProcessor.isConfigFile(filePath)) {
 *   // Validate before writing
 * }
 * ```
 */
export class PathProcessor {
  private homeDir: string;

  constructor(config: PathProcessorConfig = {}) {
    this.homeDir = config.homeDir ?? homedir();
  }

  // ============================================================
  // Path Expansion
  // ============================================================

  /**
   * Expand ~ and $HOME variables to absolute paths.
   *
   * @param path - Path that may contain ~ or $HOME
   * @param basePath - Base path for relative resolution (defaults to cwd)
   * @returns Absolute expanded path
   */
  expandPath(path: string, basePath?: string): string {
    return expandPath(path, basePath);
  }

  /**
   * Expand ~ to home directory (simple version for SDK inputs).
   * Only handles ~ prefix, not $HOME variables.
   *
   * @param path - Path that may start with ~
   * @returns Expanded path
   */
  expandTilde(path: string): string {
    if (path === '~') {
      return this.homeDir;
    }
    if (path.startsWith('~/')) {
      return this.homeDir + path.slice(1);
    }
    return path;
  }

  // ============================================================
  // Path Normalization
  // ============================================================

  /**
   * Normalize a path to use forward slashes for cross-platform comparison.
   *
   * @param path - Path to normalize
   * @returns Normalized path with forward slashes
   */
  normalize(path: string): string {
    return normalizePath(path);
  }

  /**
   * Normalize a path for comparison.
   * Resolves to absolute, normalizes separators, and lowercases on Windows.
   */
  normalizeForComparison(path: string): string {
    return normalizePathForComparison(path);
  }
  /**
   * Convert an absolute path to portable form (~ prefix if in home).
   *
   * @param absolutePath - Absolute path to convert
   * @returns Portable path
   */
  toPortable(absolutePath: string): string {
    return toPortablePath(absolutePath);
  }

  /**
   * Check if a file path is within a directory.
   *
   * @param filePath - File path to check
   * @param dirPath - Directory to check against
   * @returns true if file is within directory
   */
  isWithinDirectory(filePath: string, dirPath: string): boolean {
    return pathStartsWith(filePath, dirPath);
  }

  // ============================================================
  // Config File Detection
  // ============================================================

  /**
   * Check if a path points to a configuration file that needs validation.
   * These files have specific formats that can break applications if malformed.
   *
   * @param filePath - Path to check
   * @returns true if this is a config file
   */
  isConfigFile(filePath: string): boolean {
    const normalized = this.normalizeForComparison(this.expandPath(filePath));
    return getConfigFilePatterns().some((pattern) => pattern.test(normalized));
  }

  /**
   * Get the list of config file patterns (for debugging/logging).
   */
  getConfigPatterns(): RegExp[] {
    return [...getConfigFilePatterns()];
  }

  /**
   * Detect the type of config file based on extension.
   *
   * @param filePath - Path to check
   * @returns Config type or null if not a config file
   */
  getConfigType(filePath: string): 'json' | 'toml' | 'yaml' | 'env' | 'md' | null {
    const ext = basename(filePath).toLowerCase();

    if (ext.endsWith('.json')) return 'json';
    if (ext.endsWith('.toml')) return 'toml';
    if (ext.endsWith('.yaml') || ext.endsWith('.yml')) return 'yaml';
    if (ext.startsWith('.env')) return 'env';
    if (ext.endsWith('.md')) return 'md';

    return null;
  }

  // ============================================================
  // Utility Methods
  // ============================================================

  /**
   * Get the home directory.
   */
  getHomeDir(): string {
    return this.homeDir;
  }

  /**
   * Get the file name from a path.
   */
  getBasename(path: string): string {
    return basename(path);
  }

  /**
   * Get the directory from a path.
   */
  getDirname(path: string): string {
    return dirname(path);
  }

  /**
   * Check if a path is absolute.
   */
  isAbsolute(path: string): boolean {
    return isAbsolute(path);
  }

  /**
   * Resolve a path against a base directory.
   */
  resolve(basePath: string, ...paths: string[]): string {
    return resolve(basePath, ...paths);
  }
}
