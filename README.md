<div align="center">
	<h1>MD to Notion</h1>
	<p>
		<b>An upload of markdown files to a hierarchy of Notion pages.</b>
	</p>
	<br>
</div>

![Build status](https://github.com/vrerv/md-to-notion/actions/workflows/ci.yml/badge.svg)
[![npm version](https://badge.fury.io/js/%40vrerv%2Fmd-to-notion.svg)](https://www.npmjs.com/package/@vrerv/md-to-notion)

[🇰🇷 (한국어)](./README_KO.md) | [🇬🇧 (English)](./README.md)

## Features

- Upload markdown files to Notion pages with hierarchy
- Update existing pages if the file name is same. only update changed blocks.
- Replace local link to Notion page link automatically
- Replace local link using custom replacement
- Delete(archive) notion pages that does not exist(deleted files) in local (not to delete by default)
- Track file changes using MD5 hashes to optimize sync performance
- Support for `.notionignore` file to exclude files and directories from sync

## Usage

You need to get Notion API secret and page ID to upload your markdown files.
Follow this [guide](./docs/configure-notion.md) to get the secret and page ID.

See [Example Project](./examples/example-project) for live example.

### CLI

```bash
npx @vrerv/md-to-notion --help
```

Update all markdown files under the current directory to Notion page

```bash
npx @vrerv/md-to-notion -t <notion-api-secret> -p <notion-page-id> .
```

Or using npm:

```bash
npm run dev -- -t <your-notion-token> -p <your-page-id> <directory-path>
```

### Standalone Binary

You can build standalone executables for Linux, macOS, and Windows:

```bash
# Install dependencies
npm install

# Build binaries
npm run build:binary
```

The binaries will be created in the `build` directory:

- `md-to-notion-linux-x64` (Linux)
- `md-to-notion-macos-x64` (macOS)
- `md-to-notion-win-x64.exe` (Windows)

These binaries are completely standalone and don't require Node.js to be installed.

### .notionignore

You can create a `.notionignore` file in your directory to specify which files and directories should be excluded from syncing to Notion. The format is similar to `.gitignore`:

```
# Ignore all markdown files
*.md

# But keep important.md
!important.md

# Ignore specific directories
docs/
node_modules/

# Ignore specific files
config.json
```

### Performance Optimization

The tool uses MD5 hashes to track changes in markdown files. This means:

- Only files that have changed since the last sync will be updated in Notion
- Subsequent syncs will be much faster as unchanged files are skipped
- The state file is stored by default in `~/.md-to-notion/sync-state.json`

You can specify a custom state file location:

```bash
npx @vrerv/md-to-notion -t <notion-api-secret> -p <notion-page-id> -s /path/to/state.json .
```

This project markdown files are also published as Notion pages by this package using [GitHub Actions](./docs/github-actions.md).
You can see the [md-to-notion Notion Page](https://vrerv.notion.site/MD-To-Notion-e85be6990664452b8669c72d989ce258)

## Requirements

This package supports the following minimum versions:

- Runtime: `node >= 16`
- Type definitions (optional): `typescript >= 4.5`

Earlier versions may still work, but we encourage people building new applications to upgrade to the current stable.

## References

- [notion-sdk-js](https://github.com/makenotion/notion-sdk-js)
- [martian](https://github.com/tryfabric/martian)
- [markdown2notion](https://github.com/Rujuu-prog/markdown2notion) - Initially I tried to use this but need more feature for my use case
