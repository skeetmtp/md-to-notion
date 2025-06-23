import { Client } from "@notionhq/client"
import { Folder, MarkdownFileData } from "./read-md"
import { LogLevel, makeConsoleLogger } from "./logging"
import { SyncStateManager } from "./sync-state"
import {
  BlockObjectResponse,
  GetPageResponse,
  ListBlockChildrenResponse,
  PageObjectResponse,
  PartialBlockObjectResponse,
} from "@notionhq/client/build/src/api-endpoints"
import { mergeBlocks } from "./merge-blocks"
import path from "path"

function isBlockObjectResponse(
  child: PartialBlockObjectResponse | BlockObjectResponse
): child is BlockObjectResponse {
  return (child as BlockObjectResponse).object === "block"
}

const logger = makeConsoleLogger("sync-to-notion")
const NOTION_BLOCK_LIMIT = 100
const DEFAULT_PARALLEL_LIMIT = 25
const DEFAULT_REQUEST_DELAY = 50
const MAX_RETRY_ATTEMPTS = 3
const INITIAL_RETRY_DELAY = 1000

export type NotionPageLink = {
  id: string
  link: string
}

export interface CollectionOptions {
  parallelLimit?: number
  requestDelay?: number
  maxRetryAttempts?: number
  maxDepth?: number
  progressCallback?: (processed: number, total: number) => void
}

/**
 * Sleep utility for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Retry a function with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = MAX_RETRY_ATTEMPTS,
  initialDelay: number = INITIAL_RETRY_DELAY
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error

      // Check if it's a rate limit error
      const isRateLimit =
        error &&
        typeof error === "object" &&
        "status" in error &&
        (error.status === 429 || error.status === 503)

      if (attempt === maxAttempts || !isRateLimit) {
        throw error
      }

      const delay = initialDelay * Math.pow(2, attempt - 1)
      logger(
        LogLevel.INFO,
        `Rate limited, retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`
      )
      await sleep(delay)
    }
  }

  throw lastError || new Error("Unknown error occurred")
}

/**
 * Parallel queue processor with concurrency limit
 */
async function processInParallel<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  limit: number,
  requestDelay = 0
): Promise<R[]> {
  const results: (R | undefined)[] = new Array(items.length)
  const executing = new Set<Promise<void>>()

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item === undefined) continue
    const index = i

    const promise = (async () => {
      if (requestDelay > 0 && executing.size > 0) {
        await sleep(requestDelay)
      }
      const result = await processor(item)
      results[index] = result
    })()

    executing.add(promise)
    promise.finally(() => executing.delete(promise))

    if (executing.size >= limit) {
      await Promise.race(executing)
    }
  }

  await Promise.all(executing)
  return results.filter((r): r is R => r !== undefined)
}

/**
 * Generates a unique key for a page based on its parent ID and title to find markdown file in Notion.
 * @param parentId - The notion page ID of the parent page.
 * @param title
 */
function commonPageKey(parentId: string, title: string): string {
  return `${parentId}/${title}`
}

function getPageTitle(pageResponse: GetPageResponse): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const properties: any = Object.values(
    (pageResponse as PageObjectResponse).properties || {}
  )
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    .find((prop: unknown) => prop.type === "title")
  if (properties && properties.title && properties.title.length > 0) {
    const title =
      properties.title[0]?.plain_text || properties.title[0]?.text?.content
    if (title) {
      return title
    }
  }
  logger(LogLevel.ERROR, "Error no title found", { pageResponse })
  throw new Error(
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    `No title found. Please set a title for the page ${pageResponse.url} and try again.`
  )
}

function newNotionPageLink(response: PageObjectResponse): NotionPageLink {
  return {
    id: response.id,
    link: response.url,
  }
}

/**
 * find the maximum depth of the req block
 * @param block
 * @param depth
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const findMaxDepth = (block: any, depth = 0): number => {
  if (!block || !block.children) {
    return depth
  }
  let maxDepth = depth

  for (const child of block.children) {
    const childNode = child[child.type]
    const childDepth = findMaxDepth(childNode, depth + 1)
    maxDepth = Math.max(maxDepth, childDepth)
  }
  return maxDepth
}

export async function collectCurrentFiles(
  notion: Client,
  rootPageId: string,
  options: CollectionOptions = {}
): Promise<Map<string, NotionPageLink>> {
  const {
    parallelLimit = DEFAULT_PARALLEL_LIMIT,
    requestDelay = DEFAULT_REQUEST_DELAY,
    maxRetryAttempts = MAX_RETRY_ATTEMPTS,
    maxDepth = Infinity,
    progressCallback,
  } = options

  const linkMap = new Map<string, NotionPageLink>()
  const processedIds = new Set<string>()
  const pendingTasks = new Set<Promise<void>>()
  let processedCount = 0
  let discoveredCount = 1 // Start with root page

  async function processPageParallel(
    pageId: string,
    parentTitle: string,
    depth: number
  ): Promise<void> {
    if (processedIds.has(pageId) || depth > maxDepth) {
      return
    }
    processedIds.add(pageId)

    logger(LogLevel.INFO, "Collecting pages...", { pageId, parentTitle, depth })

    try {
      // Batch both API calls in parallel for better performance
      const [pageResponse, childrenResponse] = await Promise.all([
        retryWithBackoff(
          () => notion.pages.retrieve({ page_id: pageId }),
          maxRetryAttempts
        ),
        retryWithBackoff(
          () => notion.blocks.children.list({ block_id: pageId }),
          maxRetryAttempts
        ),
      ])

      logger(LogLevel.DEBUG, "", pageResponse)

      if (pageResponse.object !== "page") {
        processedCount++
        if (progressCallback) {
          progressCallback(
            processedCount,
            Math.max(discoveredCount, processedCount)
          )
        }
        return
      }

      const pageTitle = getPageTitle(pageResponse)
      linkMap.set(
        commonPageKey(parentTitle, pageTitle),
        newNotionPageLink(pageResponse as PageObjectResponse)
      )

      // Process child pages
      const newParentTitle =
        pageId === rootPageId ? "." : parentTitle + "/" + pageTitle
      const childPageIds: string[] = []

      for (const child of childrenResponse.results) {
        if (isBlockObjectResponse(child) && child.type === "child_page") {
          childPageIds.push(child.id)
        }
      }

      // Update discovered count and start processing children immediately
      discoveredCount += childPageIds.length

      // Process child pages in parallel, but respect the overall parallel limit
      for (const childId of childPageIds) {
        // Wait for available slot in parallel processing
        while (pendingTasks.size >= parallelLimit) {
          await Promise.race(pendingTasks)
        }

        if (requestDelay > 0) {
          await sleep(requestDelay)
        }

        const childPromise = processPageParallel(
          childId,
          newParentTitle,
          depth + 1
        )
        pendingTasks.add(childPromise)
        childPromise.finally(() => pendingTasks.delete(childPromise))
      }

      processedCount++
      if (progressCallback) {
        progressCallback(
          processedCount,
          Math.max(discoveredCount, processedCount)
        )
      }
    } catch (error) {
      logger(LogLevel.ERROR, "Error processing page", { pageId, error })
      processedCount++
      if (progressCallback) {
        progressCallback(
          processedCount,
          Math.max(discoveredCount, processedCount)
        )
      }
      throw error
    }
  }

  // Start processing with root page
  try {
    const rootPromise = processPageParallel(rootPageId, ".", 0)
    pendingTasks.add(rootPromise)
    rootPromise.finally(() => pendingTasks.delete(rootPromise))

    // Wait for all page processing to complete
    await Promise.all(pendingTasks)
  } catch (error) {
    // Ensure all pending tasks are cleaned up before rethrowing
    await Promise.allSettled(pendingTasks)
    throw error
  }

  logger(LogLevel.INFO, `Collected ${linkMap.size} pages total`)
  return linkMap
}

/**
 * Synchronizes a folder structure to a Notion page.
 *
 * @param notion
 * @param pageId - The ID of the Notion page to sync the content to.
 * @param dir - The folder structure to sync.
 * @param linkMap
 * @param deleteNonExistentFiles - Whether to delete pages in Notion that don't exist locally
 * @returns A promise that resolves when the synchronization is complete.
 */
export async function syncToNotion(
  notion: Client,
  pageId: string,
  dir: Folder,
  linkMap: Map<string, NotionPageLink> = new Map<string, NotionPageLink>(),
  deleteNonExistentFiles = false,
  syncStateManager?: SyncStateManager,
  options: CollectionOptions = {}
): Promise<void> {
  const {
    parallelLimit = DEFAULT_PARALLEL_LIMIT,
    requestDelay = DEFAULT_REQUEST_DELAY,
    maxRetryAttempts = MAX_RETRY_ATTEMPTS,
    progressCallback,
  } = options
  async function appendBlocksInChunks(
    pageId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    blocks: any[],
    afterId: string | null = null
  ): Promise<void> {
    const limitChild = findMaxDepth({ children: blocks }, 0) > 3
    // Append blocks in chunks of NOTION_BLOCK_LIMIT
    for (let i = 0; i < blocks.length; i += NOTION_BLOCK_LIMIT) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const children: Record<number, any[]> = {}
      const chunk = blocks
        .slice(i, i + NOTION_BLOCK_LIMIT)
        .map((block, index) => {
          if (limitChild && block.bulleted_list_item?.children) {
            children[index] = block.bulleted_list_item?.children
            delete block.bulleted_list_item?.children
          }
          return block
        })
      try {
        const response = await retryWithBackoff(
          () =>
            notion.blocks.children.append({
              block_id: pageId,
              children: chunk,
              after: afterId ? afterId : undefined,
            }),
          maxRetryAttempts
        )

        // Check for children in the chunk and append them separately
        for (const index in children) {
          if (children[index]) {
            await appendBlocksInChunks(
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore
              response.results[index].id,
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore
              children[index]
            )
          }
        }
      } catch (error) {
        logger(LogLevel.ERROR, "Error appending blocks", { error, chunk })
        throw error
      }
    }
  }

  async function createOrUpdatePage(
    folderName: string,
    parentId: string,
    parentName: string,
    onUpdated: (pageId: string) => Promise<void>
  ): Promise<string> {
    const key = commonPageKey(parentName, folderName)
    logger(LogLevel.INFO, "Create page", { key: key })
    if (linkMap.has(key)) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const pageId = linkMap.get(key)!.id
      await onUpdated(pageId)
      return pageId
    } else {
      const response = await retryWithBackoff(
        () =>
          notion.pages.create({
            parent: { page_id: parentId },
            properties: {
              title: [{ text: { content: folderName } }],
            },
          }),
        maxRetryAttempts
      )
      linkMap.set(key, newNotionPageLink(response as PageObjectResponse))
      return response.id
    }
  }

  async function getExistingBlocks(
    notion: Client,
    pageId: string,
    maxDepth = 10,
    currentDepth = 0
  ) {
    const existingBlocks: BlockObjectResponse[] = []

    // Fetch all pages in parallel for better performance
    const allPages = await getAllBlockPages(notion, pageId)
    existingBlocks.push(...allPages)

    // Only fetch children if we haven't reached max depth
    if (currentDepth < maxDepth) {
      // Process child blocks in parallel with rate limiting
      const blocksWithChildren = existingBlocks.filter(
        block => block.has_children
      )

      if (blocksWithChildren.length > 0) {
        await processInParallel(
          blocksWithChildren,
          async block => {
            const children = await getExistingBlocks(
              notion,
              block.id,
              maxDepth,
              currentDepth + 1
            )
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            block[block.type].children = children
          },
          Math.min(parallelLimit, 8), // Increased from 5 to 8 for better parallelism
          requestDelay
        )
      }
    } else {
      logger(
        LogLevel.INFO,
        `Reached max depth ${maxDepth}, skipping child blocks for page ${pageId}`
      )
    }

    return existingBlocks
  }

  async function getAllBlockPages(
    notion: Client,
    pageId: string
  ): Promise<BlockObjectResponse[]> {
    const allBlocks: BlockObjectResponse[] = []
    let cursor: string | undefined = undefined

    // Discover all pages first
    const pageRequests: Array<{ cursor?: string }> = [{ cursor: undefined }]

    do {
      const response: ListBlockChildrenResponse = await retryWithBackoff(
        () =>
          notion.blocks.children.list({
            block_id: pageId,
            start_cursor: cursor,
          }),
        maxRetryAttempts
      )

      const blocks = response.results.filter(
        isBlockObjectResponse
      ) as BlockObjectResponse[]
      allBlocks.push(...blocks)

      cursor = response.has_more ? response.next_cursor ?? undefined : undefined

      // If there are more pages, prepare to fetch them in parallel
      if (cursor) {
        pageRequests.push({ cursor })
      }
    } while (cursor)

    // If we only had one page, return the blocks immediately
    if (pageRequests.length <= 1) {
      return allBlocks
    }

    // For multiple pages, fetch remaining pages in parallel (excluding the first which we already fetched)
    const remainingPagePromises = pageRequests
      .slice(1)
      .map(async ({ cursor: pageCursor }) => {
        const response: ListBlockChildrenResponse = await retryWithBackoff(
          () =>
            notion.blocks.children.list({
              block_id: pageId,
              start_cursor: pageCursor,
            }),
          maxRetryAttempts
        )
        return response.results.filter(
          isBlockObjectResponse
        ) as BlockObjectResponse[]
      })

    // Wait for all remaining pages and combine results
    const remainingBlocks = await Promise.all(remainingPagePromises)
    const finalBlocks = [...allBlocks, ...remainingBlocks.flat()]

    return finalBlocks
  }

  async function syncFolder(
    folder: Folder,
    parentId: string,
    parentName: string,
    createFolder = true,
    pages: Array<{ pageId: string; file: MarkdownFileData }>,
    folderPageIds: Set<string>
  ): Promise<void> {
    let folderPageId = parentId
    if (createFolder) {
      folderPageId = await createOrUpdatePage(
        folder.name,
        parentId,
        parentName,
        async _ => {
          /* do nothing */
        }
      )
    }
    folderPageIds.add(folderPageId)

    const childParentName =
      dir.name === folder.name ? parentName : parentName + "/" + folder.name

    for (const file of folder.files) {
      const pageId = await createOrUpdatePage(
        file.fileName,
        folderPageId,
        childParentName,
        async _ => {
          /* do nothing */
        }
      )
      pages.push({ pageId: pageId, file: file })
    }

    for (const subfolder of folder.subfolders) {
      await syncFolder(
        subfolder,
        folderPageId,
        childParentName,
        true,
        pages,
        folderPageIds
      )
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function updateBlocks(pageId: string, newBlocks: any[]) {
    const blockIdSetToDelete = new Set<string>()
    const existingBlocks = await getExistingBlocks(notion, pageId, 10, 0)
    await mergeBlocks(
      existingBlocks,
      newBlocks,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (blocks: any[], after: any) => {
        let afterId = after?.id
        let appendBlocks = blocks
        if (
          (after === null || after === undefined) &&
          existingBlocks.length > 0 &&
          existingBlocks[0]?.id
        ) {
          // to overcome the limitation of the Notion API that requires an after block to append blocks,
          // append to after first block and delete first block
          const firstBlock = existingBlocks[0]
          afterId = firstBlock.id
          appendBlocks = blockIdSetToDelete.has(afterId)
            ? blocks
            : [
                ...blocks,
                {
                  ...firstBlock,
                  /* to create a new block or avoid any interference with existing blocks, set id undefined */
                  id: undefined,
                },
              ]
          blockIdSetToDelete.add(afterId)
        }
        logger(LogLevel.INFO, "Appending blocks", { appendBlocks, after })
        await appendBlocksInChunks(pageId, appendBlocks, afterId)
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (block: any) => {
        blockIdSetToDelete.add(block.id)
      }
    )
    for (const blockId of blockIdSetToDelete) {
      logger(LogLevel.INFO, "Deleting a block", { blockId })
      await retryWithBackoff(
        () => notion.blocks.delete({ block_id: blockId }),
        maxRetryAttempts
      )
    }
  }

  const pages = [] as Array<{ pageId: string; file: MarkdownFileData }>
  const folderPageIds = new Set<string>()
  await syncFolder(dir, pageId, ".", false, pages, folderPageIds)

  const linkUrlMap = new Map<string, string>(
    Array.from(linkMap.entries()).map(([key, value]) => [key, value.link])
  )

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]
    if (!page) continue

    // Progress callback for file processing
    if (progressCallback) {
      progressCallback(i, pages.length)
    }

    // Skip if the file hasn't changed
    if (page.file.hasChanged === false) {
      logger(LogLevel.INFO, "Skipping unchanged file", {
        pageId: page.pageId,
        file: page.file,
      })
      continue
    }

    const blocks = page.file.getContent(linkUrlMap)
    logger(LogLevel.INFO, "Update blocks", {
      pageId: page.pageId,
      file: page.file,
      newBlockSize: blocks.length,
      progress: `${i + 1}/${pages.length}`,
    })
    await updateBlocks(page.pageId, blocks)

    // Save state after each file is successfully synced
    if (syncStateManager) {
      const filePath = path.join(
        page.file.fileName === "." ? "" : page.file.fileName,
        ".md"
      )
      syncStateManager.saveFileState(filePath)
    }
  }

  // Final progress callback
  if (progressCallback) {
    progressCallback(pages.length, pages.length)
  }

  // Save any remaining pending changes
  if (syncStateManager) {
    syncStateManager.savePendingChanges()
  }

  // Track which pages from Notion were found in the local directory
  // Include both file pages and their parent folder pages
  const processedNotionPageIds = new Set<string>([
    ...pages.map(page => page.pageId),
    ...folderPageIds,
  ])

  if (deleteNonExistentFiles) {
    // Track pages that we've archived in this run
    const archivedPages = new Set<string>()

    // Sort keys by path length so that we delete parent paths first
    // This reduces API calls because archiving a parent will archive all children
    const sortedEntries = Array.from(linkMap.entries()).sort(
      (a, b) => a[0].length - b[0].length
    )

    for (const [key, pageLink] of sortedEntries) {
      const isRootPage =
        pageLink.id.replace(/-/g, "") === pageId.replace(/-/g, "")
      if (isRootPage) {
        continue
      }
      if (processedNotionPageIds.has(pageLink.id)) {
        continue
      }

      // Check if any ancestor path has been archived
      // For a path like "./1/2/3/file", check if "./1", "./1/2", or "./1/2/3" is archived
      let hasArchivedAncestor = false
      const pathParts = key.split("/")

      // Build paths from root to the current path and check each
      if (pathParts.length > 1) {
        for (let i = 1; i < pathParts.length; i++) {
          const ancestorPath = pathParts.slice(0, i).join("/")
          if (archivedPages.has(ancestorPath)) {
            logger(
              LogLevel.INFO,
              `Skipping page with archived ancestor: ${key}`,
              {
                ancestorPath,
                pageId: pageLink.id,
              }
            )
            hasArchivedAncestor = true
            break
          }
        }
      }

      if (hasArchivedAncestor) {
        continue
      }

      try {
        logger(LogLevel.INFO, `Deleting page: ${key}`)
        await archivePage(notion, pageLink.id)

        archivedPages.add(key)
      } catch (error) {
        logger(LogLevel.ERROR, `Error deleting page: ${key}`, {
          error,
          pageId: pageLink.id,
        })
        throw error
      }
    }
  }
}

export async function archiveChildPages(notion: Client, pageId: string) {
  logger(LogLevel.INFO, `Archiving child pages of: ${pageId}`)
  const childrenResponse = await retryWithBackoff(
    () =>
      notion.blocks.children.list({
        block_id: pageId,
      }),
    MAX_RETRY_ATTEMPTS
  )

  for (const child of childrenResponse.results) {
    if (isBlockObjectResponse(child) && child.type === "child_page") {
      await archivePage(notion, child.id)
    }
  }
}

export async function archivePage(notion: Client, pageId: string) {
  await retryWithBackoff(
    () =>
      notion.pages.update({
        page_id: pageId,
        archived: true,
      }),
    MAX_RETRY_ATTEMPTS
  )
}
