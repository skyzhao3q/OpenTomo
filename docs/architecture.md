# Architecture

OpenTomo is an Electron desktop runtime backed by shared agent, workspace, session, and configuration modules.

## System Overview

The system has two main implementation layers:

- `packages/core` and `packages/shared` provide the shared logic for agents, prompts, permissions, sessions, workspaces, runtimes, skills, and commands
- `apps/electron` provides the desktop runtime, including the Electron main process, renderer UI, IPC bridge, notifications, and window/session orchestration

Conceptually:

- `agent-core` -> `packages/core` + `packages/shared`
- `runtime` -> `apps/electron`
- `cli surface` -> root Bun scripts in `package.json`

## Core Subsystems

### Agent Layer

The `OpenTomoAgent` in `packages/shared/src/agent` wraps agent execution and normalizes tool and text events for the desktop runtime. It is responsible for:

- building system prompt context
- applying permission mode behavior
- coordinating auth and recovery flows
- integrating workspace-scoped tools, memory tools, and runtime environment state

### Workspace Layer

Workspace logic lives under `packages/shared/src/workspaces`. A workspace is a filesystem-backed unit with its own configuration and extension directories. The workspace layer handles:

- creating and repairing workspace structure
- loading and saving workspace config
- reading and writing workspace `.env`
- seeding built-in skills

### Session Layer

Session persistence lives under `packages/shared/src/sessions`. Sessions are stored locally and include metadata, messages, and related artifacts such as plans and attachments.

The session layer provides:

- session creation and lookup
- JSONL-backed persistence
- metadata updates for fast list loading
- plan file storage
- attachment directory management

### Runtime Layer

The shared runtime abstraction in `packages/shared/src/runtimes` manages bundled runtime executables and subprocess environment construction. This is how the agent layer resolves the execution environment for tools and subprocess work.

### Desktop Runtime

The Electron app in `apps/electron` owns:

- startup and onboarding
- window management
- session orchestration
- IPC handlers
- notifications
- deep links
- search and renderer-facing desktop features

## Data Flow

At a high level:

1. The renderer sends a user message through IPC.
2. The main process stores session state and any attachments.
3. `SessionManager` resolves workspace, session, model, and permission mode state.
4. `OpenTomoAgent` runs with prompt context and runtime environment setup.
5. Text, tool, auth, and completion events stream back to the renderer.
6. Final messages and updated metadata are persisted locally.

## Persistence Model

OpenTomo uses both app-level and workspace-level storage.

App-level storage under `~/.opentomo` includes:

- app config
- synced docs
- default permissions
- preset themes
- tool icons

Workspace-level storage includes:

- `config.json`
- `sessions/`
- `skills/`
- `commands/`
- `sources/`
- `.env`

## Extensibility Model

OpenTomo is designed around filesystem-backed extensions and configuration.

- Skills are instruction packages stored in the workspace
- Commands are reusable prompt snippets stored in the workspace
- Permissions can be customized with JSON config
- Themes are JSON-backed presets
- Runtime binaries can be registered through the shared runtime registry

## Current Repository Mapping

Current repository paths map to product concepts like this:

```text
packages/core      Core shared types and utilities
packages/shared    Agent, session, workspace, config, runtime, and extension logic
packages/ui        Shared React UI components
apps/electron      Desktop runtime and application shell
```
