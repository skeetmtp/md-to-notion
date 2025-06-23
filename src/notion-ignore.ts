import * as fs from "fs"
import * as path from "path"
import { LogLevel, makeConsoleLogger } from "./logging"
import { minimatch } from "minimatch"

const logger = makeConsoleLogger("notion-ignore")

/**
 * Parse a .notionignore file and return an array of ignore patterns
 * @param ignoreFilePath Path to the .notionignore file
 * @returns Array of ignore patterns
 */
export function parseNotionIgnore(ignoreFilePath: string): string[] {
  try {
    const content = fs.readFileSync(ignoreFilePath, "utf-8")
    return content
      .split("\n")
      .map(line => line.trim())
      .filter(line => line && !line.startsWith("#"))
  } catch (err) {
    logger(LogLevel.DEBUG, "No .notionignore file found or error reading it")
    return []
  }
}

function normalizePattern(pattern: string): string {
  // If pattern ends with /, treat as directory: match everything under it
  if (pattern.endsWith("/")) {
    return pattern + "**"
  }
  if (pattern.startsWith("!")) {
    const pat = pattern.slice(1)
    if (pat.endsWith("/")) {
      return "!" + pat + "**"
    }
  }
  return pattern
}

/**
 * Check if a path matches any of the ignore patterns (gitignore style)
 * @param filePath Path to check (should be relative, e.g. ./foo/bar.md)
 * @param ignorePatterns Array of ignore patterns
 * @returns true if the path should be ignored
 */
export function shouldIgnorePath(
  filePath: string,
  ignorePatterns: string[]
): boolean {
  // Convert path to use forward slashes for consistent matching
  let normalizedPath = filePath.replace(/\\/g, "/")
  if (normalizedPath.startsWith("./")) {
    normalizedPath = normalizedPath.slice(2)
  }
  let ignored = false
  for (const rawPattern of ignorePatterns) {
    const pattern = normalizePattern(rawPattern)
    if (pattern.startsWith("!")) {
      // Negation: if matches, do NOT ignore
      if (
        minimatch(normalizedPath, pattern.slice(1), {
          dot: true,
          matchBase: true,
        })
      ) {
        ignored = false
      }
    } else {
      if (minimatch(normalizedPath, pattern, { dot: true, matchBase: true })) {
        ignored = true
      }
    }
  }
  return ignored
}

/**
 * Find and parse .notionignore file in the given directory
 * @param dirPath Directory path to search for .notionignore
 * @returns Array of ignore patterns
 */
export function getIgnorePatterns(dirPath: string): string[] {
  const ignoreFilePath = path.join(dirPath, ".notionignore")
  return parseNotionIgnore(ignoreFilePath)
}
