# Getting Started

OpenTomo is a desktop runtime for workspace-scoped AI agents. Each workspace keeps its own configuration, session history, skills, commands, and environment variables on your machine.

## Prerequisites

- Bun
- Git
- A desktop environment supported by Electron
- Optional provider credentials if you want to run live model requests

## Install and Launch

```bash
git clone https://github.com/OpenTomo/opentomo.git
cd opentomo
bun install
bun run electron:dev
```

You can also run a local production-style build:

```bash
bun run electron:start
```

## First Launch Flow

On startup, OpenTomo initializes local app data under `~/.opentomo`. The app syncs bundled documentation, default permissions, preset themes, and tool icons into that directory so they are available to the runtime and agent layer.

If you have no workspaces yet, OpenTomo opens onboarding. From there you can either:

- create a new workspace folder
- open an existing folder as a workspace

If a workspace listed in config is missing on disk, OpenTomo attempts to repair the folder structure automatically at startup.

## Workspace Layout

A workspace is a local folder with OpenTomo-managed structure:

```text
my-workspace/
  config.json
  sessions/
  skills/
  commands/
  sources/
  .env
```

Key details:

- `config.json` stores workspace defaults and metadata
- `sessions/` stores conversation history and session-related artifacts
- `skills/` holds workspace-specific skill packages
- `commands/` holds reusable prompt snippets for quick access
- `.env` stores workspace-level environment variables

Built-in skills are seeded into the workspace automatically when needed.

## Running Your First Chat

1. Launch OpenTomo.
2. Create or open a workspace.
3. Create a new chat session.
4. Configure your model/provider if you want to send live requests.
5. Send a message from the chat input.

The chat runtime supports:

- file attachments
- workspace-aware execution
- per-session working directory
- per-session model selection
- persistent session history

## Permission Modes

OpenTomo supports three execution modes per session:

- `safe`: read-only exploration mode that blocks writes
- `ask`: prompts before dangerous or state-changing operations
- `allow-all`: skips permission checks and allows full execution

Workspaces can define defaults, and sessions can switch modes as needed.

## Extension Points

You can customize behavior without changing core code:

- add skills under `skills/`
- add reusable commands under `commands/`
- set workspace environment variables in `.env`
- customize execution behavior with `permissions.json`
- adjust themes and app-level defaults under `~/.opentomo`

## Notes on Model Execution

OpenTomo can launch and initialize without provider credentials. To run live model-backed conversations, you still need to configure a supported provider and credentials in the app settings.
