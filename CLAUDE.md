# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Compile

```bash
npm run build        # Compile TypeScript to build/ directory
npm run clean        # Remove build/ directory
npm run prepare      # Build before npm install (used by npm)
```

### Code Quality

```bash
npm run lint         # Run prettier, eslint, and cspell checks
npm run prettier     # Format code with prettier
npm test             # Run Jest tests
```

### Testing

```bash
npm test                    # Run all tests
jest <test-file.test.ts>    # Run specific test file
jest --watch                # Run tests in watch mode
```

### CLI Testing

```bash
# Build first, then test CLI
npm run build
./build/src/md-to-notion-cli.js --help
```

## Architecture Overview

This is a TypeScript CLI tool that syncs markdown files to Notion pages while preserving directory hierarchy.

### Core Data Flow

```
Directory → Read MD → Process Links → Convert to Blocks → Sync to Notion
```

### Key Modules

**`src/md-to-notion-cli.ts`** - CLI entry point and orchestration

- Parses command-line args with Commander.js
- Configures link replacement strategies
- Orchestrates the entire sync process

**`src/read-md.ts`** - Markdown file discovery and parsing

- `readMarkdownFiles()`: Recursively scans directories with include/exclude filters
- Returns `Folder` hierarchy with lazy-loaded `MarkdownFileData`
- Uses gray-matter for frontmatter parsing

**`src/replace-links.ts`** - Link processing before Notion conversion

- `replaceInternalMarkdownLinks()`: Converts internal links to Notion URLs
- Resolves relative paths (`../`, `./`) correctly
- Supports custom link replacement patterns

**`src/sync-to-notion.ts`** - Notion API integration

- `syncToNotion()`: Creates/updates Notion pages to mirror directory structure
- `collectCurrentFiles()`: Parallel page discovery with configurable concurrency
- Handles page deletion when files are removed locally
- Manages API rate limits with intelligent retry and exponential backoff
- Supports parallel processing with depth limits for performance

**`src/merge-blocks.ts`** - Efficient content synchronization

- `mergeBlocks()`: Compares existing vs new blocks to minimize API calls
- Identifies append/update/delete operations
- Uses deep content comparison with `compareBlock()`

### Data Structures

```typescript
interface Folder {
  name: string
  files: MarkdownFileData[]
  subfolders: Folder[]
}

interface MarkdownFileData {
  fileName: string
  getContent: (linkMap: Map<string, string>) => any[] // Notion blocks
}

interface CollectionOptions {
  parallelLimit?: number
  requestDelay?: number
  maxRetryAttempts?: number
  maxDepth?: number
  progressCallback?: (processed: number, total: number) => void
}
```

### Key Dependencies

- `@notionhq/client`: Official Notion API client
- `@tryfabric/martian`: Markdown to Notion blocks converter
- `commander`: CLI argument parsing
- `gray-matter`: Frontmatter parsing

## Performance Optimizations

### Page Discovery Performance
- **Parallel Processing**: `collectCurrentFiles()` uses true parallel processing instead of level-by-level sequential processing
- **Batched API Calls**: Each page requires parallel `pages.retrieve()` + `blocks.children.list()` calls instead of sequential
- **Configurable Concurrency**: `--parallel-limit` (default: 25) controls maximum concurrent API requests
- **Rate Limiting**: Intelligent retry with exponential backoff for 429/503 errors

### Block Processing Performance  
- **Depth Limits**: `--max-depth` (default: 10) prevents infinite recursion in deeply nested blocks
- **Parallel Pagination**: Multiple block pages fetched concurrently when possible
- **Optimized Recursion**: Child blocks processed in parallel with configurable limits

### CLI Performance Options
```bash
--parallel-limit <number>        # Max parallel requests (default: 25)
--request-delay <number>         # Delay between requests in ms (default: 50)
--max-retry-attempts <number>    # Max retries for failed requests (default: 3)
--max-depth <number>            # Max block recursion depth (default: 10)
--show-progress                 # Show progress indicators
```

### Expected Performance Gains
- **Large Hierarchies**: 60-80% faster page discovery
- **Flat Structures**: 30-50% performance improvement
- **Reliability**: Significant reduction in rate limit failures
- **User Experience**: Real-time progress monitoring

## Testing Strategy

Tests use Jest with ts-jest preset. Key test files:

- `merge-blocks.test.ts`: Block comparison and merging logic
- `replace-links.test.ts`: Link replacement patterns
- `sync-to-notion.test.ts`: Notion API integration
- `read-me.test.ts`: Markdown file parsing

## Build Configuration

- TypeScript compiles to `build/` directory
- Target: ES2019 for Node.js compatibility
- Supports Node.js 16+ (see engines in package.json)
- CLI binary: `build/src/md-to-notion-cli.js`
