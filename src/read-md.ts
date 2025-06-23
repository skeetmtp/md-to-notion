import * as fs from "fs"
import * as path from "path"
import matter from "gray-matter"
import { markdownToBlocks } from "@tryfabric/martian"
import { LogLevel, makeConsoleLogger } from "./logging"
import {
  removeMarkdownLinks,
  replaceInternalMarkdownLinks,
} from "./replace-links"
import { SyncStateManager } from "./sync-state"
import { getIgnorePatterns, shouldIgnorePath } from "./notion-ignore"

export interface Folder {
  name: string
  files: MarkdownFileData[]
  subfolders: Folder[]
}

export interface MarkdownFileData {
  fileName: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getContent: (linkMap: Map<string, string>) => any[]
  hasChanged?: boolean
}

const logger = makeConsoleLogger("read-md")

/**
 * Read and process Markdown files from a specified directory.
 * The function reads all Markdown files in the directory and its subdirectories, following symbolic links,
 * extracts their content, and converts it to Notion block format.
 *
 * @param dirPath - The path to the directory containing the Markdown files.
 * @param filter - A function that determines if a path should be processed. node_modules are excluded by default.
 * @param replacer
 * @param syncStateManager - Optional SyncStateManager to track file changes
 * @returns A hierarchical structure of folders and files that contain Markdown files.
 */
export function readMarkdownFiles(
  dirPath: string,
  filter: (path: string) => boolean = path => !path.includes("node_modules"),
  replacer?: (text: string, linkPathFromRoot: string) => string,
  syncStateManager?: SyncStateManager
): Folder | null {
  // Get ignore patterns from .notionignore file
  const ignorePatterns = getIgnorePatterns(dirPath)

  function walk(currentPath: string): Folder | null {
    const folder: Folder = {
      name: dirPath === currentPath ? "." : path.basename(currentPath),
      files: [],
      subfolders: [],
    }

    const entries = fs.readdirSync(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name)
      const pathFromRoot = path.relative(dirPath, entryPath)

      // Add ./ to the path to match start of the path
      const normalizedPath = "./" + pathFromRoot

      // Check if path should be ignored by .notionignore
      if (shouldIgnorePath(normalizedPath, ignorePatterns)) {
        logger(
          LogLevel.INFO,
          `Ignoring path due to .notionignore: ${pathFromRoot}`
        )
        continue
      }

      // Check custom filter
      if (!filter(normalizedPath)) {
        logger(LogLevel.INFO, `Skipping path: ${pathFromRoot}`)
        continue
      }

      let stats

      try {
        // Use fs.statSync to follow symbolic links
        stats = fs.statSync(entryPath)
      } catch (err) {
        console.error(`Error reading path: ${entryPath}`, err)
        continue
      }

      if (stats.isDirectory()) {
        const subfolder = walk(entryPath)
        if (subfolder) {
          folder.subfolders.push(subfolder)
        }
      } else if (stats.isFile() && entry.name.endsWith(".md")) {
        const content = matter(fs.readFileSync(entryPath, "utf-8")).content
        const fileNameWithoutExtension = path.basename(entry.name, ".md")
        const hasChanged = syncStateManager
          ? syncStateManager.hasFileChanged(pathFromRoot, content)
          : true

        folder.files.push({
          fileName: fileNameWithoutExtension,
          hasChanged,
          getContent: (linkMap: Map<string, string>) => {
            const noLinkContent = removeMarkdownLinks(
              replaceInternalMarkdownLinks(
                content,
                linkMap,
                pathFromRoot,
                replacer
              )
            )
            return markdownToBlocks(noLinkContent)
          },
        })
      }
    }

    // Return the folder only if it contains any files or subfolders with Markdown files
    return folder.files.length > 0 || folder.subfolders.length > 0
      ? folder
      : null
  }

  const result = walk(dirPath)
  if (result) {
    printFolderHierarchy(result, "", ignorePatterns, dirPath)
  }
  return result
}

/**
 * Prints the folder hierarchy structure.
 *
 * @param folder - The root folder to start printing from.
 * @param indent - The current level of indentation (used for recursion).
 * @param ignorePatterns - Optional array of ignore patterns to show ignored files
 * @param basePath - The base directory path for resolving absolute paths
 */
export function printFolderHierarchy(
  folder: Folder | null,
  indent = "",
  ignorePatterns?: string[],
  basePath?: string
): void {
  if (!folder) return // Exit if the folder is null

  // Print the current folder's name
  logger(LogLevel.INFO, `${indent}${folder.name}/`)

  // Print the files in the current folder
  for (const file of folder.files) {
    logger(LogLevel.INFO, `${indent}  - ${file.fileName}.md`)
  }

  // If ignore patterns are provided, print ignored files
  if (ignorePatterns && basePath) {
    const currentPath =
      folder.name === "." ? basePath : path.join(basePath, folder.name)
    try {
      const ignoredFiles = fs
        .readdirSync(currentPath)
        .filter(file => {
          const filePath = path.join(
            folder.name === "." ? "" : folder.name,
            file
          )
          const normalizedPath = "./" + filePath
          return shouldIgnorePath(normalizedPath, ignorePatterns)
        })
        .filter(file => file.endsWith(".md"))

      if (ignoredFiles.length > 0) {
        logger(LogLevel.INFO, `${indent}  [ignored]`)
        for (const file of ignoredFiles) {
          logger(LogLevel.INFO, `${indent}    - ${file}`)
        }
      }
    } catch (err) {
      // Skip if directory doesn't exist or can't be read
      logger(LogLevel.DEBUG, `Could not read directory: ${currentPath}`)
    }
  }

  // Recursively print each subfolder
  for (const subfolder of folder.subfolders) {
    printFolderHierarchy(subfolder, indent + "  ", ignorePatterns, basePath)
  }
}
