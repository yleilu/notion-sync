# notion-sync

Background daemon that syncs a local directory of markdown files to a Notion page tree.

## Setup

1. Create a [Notion integration](https://www.notion.so/my-integrations) and get the API secret
2. Share the target Notion page with your integration
3. Provide the API secret via one of:

```bash
# Environment variable
export NOTION_SYNC_API_SECRET="your-secret-here"

# Config file (~/.notion-sync/config.json)
{ "apiSecret": "your-secret-here" }

# CLI flag
notion-sync ./docs <page-id> --api-secret "your-secret-here"
```

## Install

```bash
npm install
npm run build
```

## Usage

```bash
# Start daemon
notion-sync <path-to-dir> <page-id> [options]

# List running daemons
notion-sync list

# Stop daemon by ID (7-char hash shown by list/start)
notion-sync stop <id>
```

### Options

| Flag | Description |
|------|-------------|
| `--api-secret <secret>` | Notion API secret (overrides env/config) |
| `--port <port>` | Webhook server port (default: 4648) |
| `--config <path>` | Config file path (default: `~/.notion-sync/config.json`) |
| `--name <namespace>` | Namespace name for isolation on shared pages (default: directory basename) |

### Example

```bash
# Start syncing ./docs to a Notion page
npx tsx src/index.ts ./docs 30fde7ba5068809da7f9f0f5f9bbd93e

# With a namespace (creates a child page "my-project" under the target page)
npx tsx src/index.ts ./docs 30fde7ba5068809da7f9f0f5f9bbd93e --name my-project

# List running daemons
npx tsx src/index.ts list

# Stop by daemon ID
npx tsx src/index.ts stop a1b2c3d
```

## How it works

- **Startup sync**: On launch, scans the local directory and pushes all `.md` files to Notion. Unchanged files are skipped via fast mtime+size check, falling back to content hash comparison.
- **File watcher**: Monitors the directory for changes using chokidar. New/modified files are pushed to Notion with a 500ms debounce.
- **Webhook server**: Listens for Notion webhook notifications and pulls remote changes back to local files.
- **Directory mapping**: Subdirectories become nested Notion pages. File names (without `.md`) become page titles.
- **Namespace isolation**: Each daemon creates a child page under the target page (named by `--name` or directory basename), so multiple syncs can share one Notion page without colliding.
- **State management**: Sync state is stored in `~/.notion-sync/<id>/state.json` where `<id>` is a 7-character hash of `pageId:dirPath`. Tracks file-to-page mappings, content hashes, and mtime/size for fast skip.
- **Daemon lifecycle**: PID file tracks the running process. `stop` sends SIGTERM for graceful shutdown. Startup waits for initial sync to complete before detaching.
- **Pruning**: On startup, archived or deleted Notion pages are pruned from state. Locally deleted files are archived on Notion.
