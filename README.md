# notion-sync

Background daemon that bi-directionally syncs a local directory of markdown files with a Notion page tree.

## Setup

1. Create a [Notion integration](https://www.notion.so/my-integrations) and get the API secret
2. Share the target Notion page with your integration
3. Provide the API secret via one of:

```bash
# Environment variable
export NOTION_SYNC_API_SECRET="your-secret-here"

# Config file (~/.notion-sync/config.json)
{ "apiSecret": "your-secret-here", "port": 4648 }

# CLI flag
notion-sync ./docs <page-id> --api-secret "your-secret-here"
```

## Install

```bash
npm install
npm run build

# Optional: link globally to ~/.local/bin/notion-sync
npm run install:link
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
notion-sync ./docs 30fde7ba5068809da7f9f0f5f9bbd93e

# With a namespace (creates a child page "my-project" under the target page)
notion-sync ./docs 30fde7ba5068809da7f9f0f5f9bbd93e --name my-project

# List running daemons
notion-sync list

# Stop by daemon ID
notion-sync stop a1b2c3d
```

For development without building:

```bash
npm run dev -- ./docs 30fde7ba5068809da7f9f0f5f9bbd93e
```

## How it works

### Sync lifecycle

1. **Startup sync**: Scans the local directory and pushes all `.md` files to Notion. Unchanged files are skipped via fast mtime+size check, falling back to content hash comparison. Then catches up on remote changes made while the daemon was down, and pulls any Notion-only pages to local files.
2. **File watcher**: Monitors the directory for changes using chokidar (follows symlinks). New/modified files are pushed to Notion with a 1-second debounce. Deleted files are archived on Notion.
3. **Webhook server**: Listens on `POST /` for Notion webhook events (`page.content_updated`). Pulls changed content back to local files. Also exposes `GET /health` for monitoring.

### Key concepts

- **Directory mapping**: Subdirectories become nested Notion pages. File names (without `.md`) become page titles.
- **Namespace isolation**: Each daemon creates a child page under the target page (named by `--name` or directory basename), so multiple syncs can share one Notion page without colliding.
- **State management**: Sync state is stored in `~/.notion-sync/<id>/state.json` where `<id>` is a 7-character hash of `pageId:dirPath`. Tracks file-to-page mappings, content hashes, and mtime/size for fast skip.
- **Daemon lifecycle**: PID file tracks the running process. `stop` sends SIGTERM for graceful shutdown. Startup waits for initial sync to complete before detaching.
- **Sync coordination**: A lock mechanism prevents the watcher and webhook handler from interfering with each other — webhook pulls are skipped while a watcher sync is in progress, and watcher ignores file writes caused by webhook pulls.
- **Pruning**: On startup, archived or deleted Notion pages are pruned from state. Locally deleted files are archived on Notion.
