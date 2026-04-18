# OpenTomo

An open-source desktop agent client for building and running local-first AI workflows easily.

OpenTomo is a workspace-based desktop app for running chat-driven agents on your machine. It combines a desktop UI, local session storage, permission controls, file-aware conversations, and filesystem-backed extension points for skills and commands.

## Key Features

- Local-first workspaces with isolated settings, sessions, skills, and commands
- Chat-based desktop runtime for multi-step agent workflows
- Permission modes for safe exploration, approval-based execution, and full autonomy
- Persistent sessions with attachments, plans, and workspace-scoped history
- Extensible skills, reusable commands, workspace `.env`, and permissions config
- Desktop-native capabilities including search, notifications, deep links, and themes

## Demo

Run the desktop app locally:

```bash
bun install
bun run electron:dev
```

Expected result:

- A Vite dev server starts
- Electron launches the OpenTomo desktop app
- On first launch, OpenTomo initializes `~/.opentomo` and guides you into creating or opening a workspace

The agent API lives in the shared core modules:

```ts
import { OpenTomoAgent } from '@opentomo/shared/agent'
```

## Quick Start

### Prerequisites

- Bun
- Node.js 18+ compatible environment
- macOS, Linux, or Windows

### Install

```bash
git clone https://github.com/OpenTomo/opentomo.git
cd opentomo
bun install
```

### Start the app

Development mode:

```bash
bun run electron:dev
```

Local production-style run:

```bash
bun run electron:start
```

### What happens on first launch

- OpenTomo creates app data under `~/.opentomo`
- Built-in docs, default permissions, preset themes, and tool icons are synced locally
- If no workspace exists yet, the app opens onboarding so you can create one
- Workspace folders are created with the structure OpenTomo needs to persist sessions and extensions

Note: launching the app does not require provider credentials. Sending live model requests does require provider and credential setup.

## Use Cases

- Personal AI workspace for local tasks and notes
- File-aware desktop agent for project folders
- Prototyping agent workflows with explicit guardrails
- Experimenting with custom skills and reusable commands
- Building separate assistant setups for different workspaces or contexts

## Architecture Overview

OpenTomo is organized around three conceptual layers:

- `agent-core`: shared agent, prompt, permission, session, workspace, and extension logic in `packages/core` and `packages/shared`
- `runtime`: the desktop application in `apps/electron`, including the Electron main process, renderer, IPC, and session orchestration
- `CLI surface`: the repo-level Bun scripts used to build, run, lint, and test the project

For a deeper walkthrough, see [Getting Started](docs/getting-started.md) and [Architecture](docs/architecture.md).

## Extensibility

OpenTomo is designed to be extended through the filesystem and workspace configuration:

- Add workspace skills under `skills/`
- Add reusable slash-style commands under `commands/`
- Set per-workspace environment variables in `.env`
- Tune execution rules with `permissions.json`
- Customize visual appearance through themes and app defaults under `~/.opentomo`
- Build on top of the shared runtime and agent modules in `packages/shared`

## Repository Layout

Current repository layout:

```text
apps/electron/     Desktop runtime
packages/core/     Shared types and core utilities
packages/shared/   Agent, workspace, session, prompt, and extension logic
packages/ui/       Shared React UI components
docs/              OSS-facing documentation
```

Conceptually, this maps to:

- `agent-core` -> `packages/core` + `packages/shared`
- `runtime` -> `apps/electron`
- `cli` -> root `package.json` scripts

## License

OpenTomo is licensed under the Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Trademarks

`OpenTomo` and `WorkTomo` are trademarks of skyzhao3q. See [TRADEMARKS.md](TRADEMARKS.md).

## Acknowledgements

OpenTomo was developed with inspiration from several open-source projects:

- [open-claude-cowork](https://github.com/ComposioHQ/open-claude-cowork) by ComposioHQ for the concept and design direction of a collaborative AI workspace
- [craft-agents-oss](https://github.com/lukilabs/craft-agents-oss) by lukilabs for polished UI design and agent-platform architecture ideas
- [openclaw](https://github.com/openclaw/openclaw) by openclaw for agent personality customization patterns centered around `SOUL.md`
- [pi-mono](https://github.com/badlogic/pi-mono) by badlogic for a simple and robust agent framework approach
