#!/usr/bin/env node

import { printFolderHierarchy, readMarkdownFiles, syncToNotion } from "./index"
import { Command } from "commander"
import { description, version } from "../package.json"
import { Client } from "@notionhq/client"
import {
  collectCurrentFiles,
  archiveChildPages,
  CollectionOptions,
} from "./sync-to-notion"
import { SyncStateManager } from "./sync-state"
import path from "path"
import os from "os"

const REPL_TEXT = "${text}"
const REPL_LINK_PATH_FROM_ROOT = "${linkPathFromRoot}"
const REPL_GITHUB_PATH = "${githubPath}"
const GIT_HUB_LINK_REPLACEMENT = `[${REPL_TEXT}](https://github.com/${REPL_GITHUB_PATH}/${REPL_LINK_PATH_FROM_ROOT}?raw=true)`

const program = new Command()

async function main(
  directory: string,
  options: {
    verbose: boolean
    token: string
    pageId: string
    include: string
    exclude: string
    linkReplacer: string
    useGithubLinkReplacer: string
    delete: boolean
    renew: boolean
    stateFile: string
    parallelLimit: number
    requestDelay: number
    maxRetryAttempts: number
    maxDepth: number
    showProgress: boolean
  }
) {
  let replacer
  if (options.linkReplacer) {
    replacer = (text: string, linkFromRootPath: string) =>
      options.linkReplacer
        .replace("${text}", text)
        .replace("${linkPathFromRoot}", linkFromRootPath)
  } else if (options.useGithubLinkReplacer) {
    replacer = (text: string, linkFromRootPath: string) =>
      GIT_HUB_LINK_REPLACEMENT.replace(
        "${githubPath}",
        options.useGithubLinkReplacer
      )
        .replace("${text}", text)
        .replace("${linkPathFromRoot}", linkFromRootPath)
  }

  // Initialize sync state manager
  const stateFile =
    options.stateFile ||
    path.join(os.homedir(), ".md-to-notion", "sync-state.json")
  const syncStateManager = new SyncStateManager(stateFile)

  const dir = readMarkdownFiles(
    directory,
    path => {
      const exclude = options.exclude || "node_modules"
      const include = options.include || path
      return path.includes(include) && !path.includes(exclude)
    },
    replacer,
    syncStateManager
  )

  if (options.verbose) {
    printFolderHierarchy(dir)
  }

  if (dir) {
    const notion = new Client({ auth: options.token })

    // Configure performance options
    const collectionOptions: CollectionOptions = {
      parallelLimit: options.parallelLimit,
      requestDelay: options.requestDelay,
      maxRetryAttempts: options.maxRetryAttempts,
      maxDepth: options.maxDepth,
      progressCallback: options.showProgress
        ? (processed: number, total: number) => {
            const percentage =
              total > 0 ? Math.round((processed / total) * 100) : 0
            const timestamp = new Date()
              .toISOString()
              .split("T")[1]
              ?.split(".")[0] || "00:00:00"
            process.stdout.write(
              `\r[${timestamp}] Progress: ${processed}/${total} pages (${percentage}%)`
            )
            if (processed === total) {
              console.log() // New line when complete
            }
          }
        : undefined,
    }

    if (options.renew) {
      await archiveChildPages(notion, options.pageId)
    }

    console.log("Collecting existing pages from Notion...")
    const linkMap = await collectCurrentFiles(
      notion,
      options.pageId,
      collectionOptions
    )
    console.log(`Found ${linkMap.size} existing pages`)

    console.log("Syncing content to Notion...")
    await syncToNotion(
      notion,
      options.pageId,
      dir,
      linkMap,
      options.delete,
      syncStateManager,
      collectionOptions
    )
  }

  console.log("Sync complete!")
}

program
  .version(version)
  .description(description)
  .argument("<directory>", "Directory containing markdown files")
  .option(
    "-t, --token <token>",
    "Notion API Token, default is environment variable NOTION_API_TOKEN",
    process.env["NOTION_API_TOKEN"]
  )
  .option(
    "-p, --page-id <id>",
    "Target Notion root page ID, default is env MD_TO_NOTION_PAGE_ID",
    process.env["MD_TO_NOTION_PAGE_ID"]
  )
  .option(
    "-i, --include <text>",
    "Scan only path includes text, default is all files"
  )
  .option(
    "-r, --link-replacer <replacement>",
    "Custom link replacer string.\n" +
      `Use ${REPL_TEXT}, ${REPL_LINK_PATH_FROM_ROOT} to replace text and link.\n` +
      "Try -g if you want to use GitHub raw link"
  )
  .option(
    "-g, --use-github-link-replacer <githubPath>",
    "Replace links with raw GitHub links.\n" +
      "<githubPath> will be 'vrerv/md-to-notion/blob/main' for example.\n" +
      `This is short version of -r '${GIT_HUB_LINK_REPLACEMENT.replace(
        REPL_GITHUB_PATH,
        "<githubPath>"
      )}' option`
  )
  .option("-v, --verbose", "Print folder hierarchy", false)
  .option(
    "-d, --delete",
    "Delete pages in Notion that don't exist locally",
    false
  )
  .option("-n, --renew", "Delete all pages in Notion before sync", false)
  .option(
    "-s, --state-file <path>",
    "Path to sync state file (default: ~/.md-to-notion/sync-state.json)"
  )
  .option(
    "--parallel-limit <number>",
    "Maximum number of parallel API requests (default: 25)",
    value => parseInt(value),
    25
  )
  .option(
    "--request-delay <number>",
    "Delay between API requests in milliseconds (default: 50)",
    value => parseInt(value),
    50
  )
  .option(
    "--max-retry-attempts <number>",
    "Maximum number of retry attempts for failed requests (default: 3)",
    value => parseInt(value),
    3
  )
  .option(
    "--max-depth <number>",
    "Maximum recursion depth for reading nested blocks (default: 10)",
    value => parseInt(value),
    10
  )
  .option("--show-progress", "Show progress indicators during sync", false)
  .action(main)

program.parse(process.argv)
