# notion-sync

Background daemon that syncs a local directory of markdown files to a Notion page tree.

## Setup

1. Create a [Notion integration](https://www.notion.so/my-integrations) and get the API secret
2. Share the target Notion page with your integration
3. Set the environment variable:

```bash
export NOTION_SYNC_API_SECRET="your-secret-here"
```

## Install

```bash
npm install
npm run build
```

## Usage

```bash
# Start daemon (syncs directory to a Notion page)
notion-sync <path-to-dir> <page-id>

# Stop daemon
notion-sync stop <path-to-dir>
```

### Example

```bash
# Start syncing ./docs to a Notion page
npx tsx src/index.ts ./docs 30fde7ba5068809da7f9f0f5f9bbd93e

# Stop the daemon
npx tsx src/index.ts stop ./docs
```

## How it works

- **Startup sync**: On launch, scans the local directory and pushes all `.md` files to Notion. Unchanged files are skipped.
- **File watcher**: Monitors the directory for changes using chokidar. New/modified files are pushed to Notion with a 500ms debounce.
- **Notion poller**: Polls Notion every 30s for remote changes and pulls them back to local files.
- **Directory mapping**: Subdirectories become nested Notion pages. File names (without `.md`) become page titles.
- **State management**: Sync state is stored in `~/.notion-sync/<hash>/` with file-to-page mappings and content hashes.
- **Daemon lifecycle**: PID file tracks the running process. `stop` sends SIGTERM for graceful shutdown.
