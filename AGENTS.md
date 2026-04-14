# AGENTS.md

This file provides guidance to AI coding agents working on the `skills` CLI codebase.

## Project Overview

`skills` is the CLI for the open agent skills ecosystem.

## Commands

| Command                       | Description                                                              |
| ----------------------------- | ------------------------------------------------------------------------ |
| `skills`                      | Show banner with available commands                                      |
| `skills add <pkg>`            | Install skills from git repos, URLs, or local paths into the repository  |
| `skills apply`                | Apply installed repository skills to agent directories                   |
| `skills remove [skills...]`   | Remove installed skills and clean up applied agent copies/symlinks       |
| `skills experimental_install` | Restore skills from local `skills-lock.json`                             |
| `skills experimental_sync`    | Sync skills from `node_modules` into agent dirs                          |
| `skills list`                 | List installed skills (alias: `ls`)                                      |
| `skills update [skills...]`   | Update repository-installed skills to latest versions                    |
| `skills init [name]`          | Create a new `SKILL.md` template                                         |

Aliases: `skills a` works for `add`. `skills ls` works for `list`. `skills rm` and `skills r` work for `remove`. `skills i`, `skills install` with no package restore from local `skills-lock.json`. `skills experimental_sync` crawls `node_modules` for skills.

## Architecture

```
src/
├── cli.ts           # Main entry point, command routing, help/banner, update/check
├── cli.test.ts      # CLI tests
├── add.ts           # Install skills into the central repository; optional --apply handoff
├── apply.ts         # Apply repository-installed skills to agent directories
├── add-prompt.test.ts # Add prompt behavior tests
├── add.test.ts      # Add command tests
├── constants.ts     # Shared constants
├── find.ts           # Find/search command
├── list.ts           # List repository-installed skills or agent-applied skills
├── list.test.ts      # List command tests
├── remove.ts         # Remove repository skills and clean up applied agent state
├── remove.test.ts    # Remove command tests
├── agents.ts        # Agent definitions and detection
├── installer.ts     # Repository install/apply logic (copy/symlink) + listInstalledSkills
├── skills.ts        # Skill discovery and parsing
├── skill-lock.ts    # Repository lock file management (~/.config/skills/skill-lock.json)
├── local-lock.ts    # Local project lock file management (skills-lock.json, checked in)
├── sync.ts          # Sync command - crawl node_modules for skills
├── source-parser.ts # Parse git URLs, GitHub shorthand, local paths
├── git.ts           # Git clone operations
├── telemetry.ts     # Anonymous usage tracking
├── types.ts         # TypeScript types
├── mintlify.ts      # Mintlify skill fetching (legacy)
├── plugin-manifest.ts # Plugin manifest discovery support
├── prompts/         # Interactive prompt helpers
│   └── search-multiselect.ts
├── providers/       # Remote skill providers (GitHub, HuggingFace, Mintlify)
│   ├── index.ts
│   ├── registry.ts
│   ├── types.ts
│   ├── huggingface.ts
│   ├── mintlify.ts
│   └── wellknown.ts
├── init.test.ts     # Init command tests
└── test-utils.ts    # Test utilities

tests/
├── cross-platform-paths.test.ts   # Path normalization across platforms
├── full-depth-discovery.test.ts   # --full-depth skill discovery tests
├── openclaw-paths.test.ts         # OpenClaw-specific path tests
├── plugin-manifest-discovery.test.ts # Plugin manifest skill discovery
├── remove-canonical.test.ts      # Remove behavior against repository storage + agent cleanup
├── sanitize-name.test.ts         # Tests for sanitizeName (path traversal prevention)
├── skill-matching.test.ts        # Tests for filterSkills (multi-word skill name matching)
├── source-parser.test.ts         # Tests for URL/path parsing
├── installer-symlink.test.ts     # Tests for symlink installation
├── list-installed.test.ts        # Tests for listing installed/applied skills
├── skill-path.test.ts            # Tests for skill path handling
├── sync.test.ts                  # experimental_sync behavior and lock file output
├── wellknown-provider.test.ts # Tests for well-known provider
├── xdg-config-paths.test.ts      # XDG config path handling tests
└── dist.test.ts                  # Tests for built distribution
```

## Update Checking System

### How `skills check` and `skills update` Work

1. Read `~/.config/skills/skill-lock.json` for repository-installed skills
2. Filter to GitHub-backed skills that have both `skillFolderHash` and `skillPath`
3. For each skill, call `fetchSkillFolderHash(source, skillPath, token)`. Optional auth token is sourced from `GITHUB_TOKEN`, `GH_TOKEN`, or `gh auth token` to improve rate limits.
4. `fetchSkillFolderHash` calls GitHub Trees API directly (`/git/trees/<branch>?recursive=1` for `main`, then `master` fallback)
5. Compare latest folder tree SHA with lock file `skillFolderHash`; mismatch means update available
6. `skills update` reinstalls changed skills into the repository and can then re-apply them if requested by the CLI flow

### Lock File Compatibility

The repository lock file format is v4. Key field: `skillFolderHash` (GitHub tree SHA for the skill folder).

If reading an older lock file version, it's wiped. Users must reinstall skills to populate the new format.

### Repository vs Applied State

- Canonical installed skills live in `~/.config/skills/<skill-name>/`
- Repository metadata lives in `~/.config/skills/skill-lock.json`
- Applied state is not tracked in a second global lock file; it is derived from agent directories on disk
- `skills add` installs to the repository
- `skills apply` creates symlinks/copies from the repository into agent skill directories
- `skills remove` removes the repository entry and cleans up matching applied agent directories
- `skills list` without `--agent` reads the repository lock; with `--agent`, it scans applied agent directories

## Key Integration Points

| Feature                    | Implementation                                                |
| -------------------------- | ------------------------------------------------------------- |
| `skills add`               | `src/add.ts` - install/discover into repository               |
| `skills apply`             | `src/apply.ts` - apply repository skills to agents            |
| `skills remove`            | `src/remove.ts` - remove repository skills + agent cleanup    |
| `skills list`              | `src/list.ts` - repository listing or agent-applied listing   |
| `skills experimental_sync` | `src/sync.ts` - crawl `node_modules`                          |
| `skills check`             | `src/cli.ts` + `fetchSkillFolderHash` in `src/skill-lock.ts`  |
| `skills update`            | `src/cli.ts` direct hash compare + repository reinstall       |

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Test locally
pnpm dev add vercel-labs/agent-skills --list
pnpm dev add vercel-labs/agent-skills --apply --agent codex
pnpm dev apply --skill some-skill --agent claude-code
pnpm dev experimental_sync
pnpm dev check
pnpm dev update
pnpm dev init my-skill

# Run all tests
pnpm test

# Run specific test file(s)
pnpm test tests/sanitize-name.test.ts
pnpm test tests/skill-matching.test.ts tests/source-parser.test.ts

# Type check
pnpm type-check

# Format code
pnpm format

# Check formatting
pnpm format:check

# Validate and sync agent metadata/docs
pnpm run -C scripts validate-agents.ts
pnpm run -C scripts sync-agents.ts
```

## Code Style

This project uses Prettier for code formatting. **Always run `pnpm format` before committing changes** to ensure consistent formatting.

```bash
# Format all files
pnpm format

# Check formatting without fixing
pnpm format:check
```

CI will fail if code is not properly formatted.

## Publishing

```bash
# 1. Bump version in package.json
# 2. Build
pnpm build
# 3. Publish
npm publish
```

## Adding a New Agent

1. Add the agent definition to `src/agents.ts`
2. Ensure `skillsDir`, optional `globalSkillsDir`, and `detectInstalled()` match the agent's actual filesystem conventions
3. Validate both repository apply flow and listing/removal behavior for that agent
4. Run `pnpm run -C scripts validate-agents.ts` to validate
5. Run `pnpm run -C scripts sync-agents.ts` to update README.md and package keywords
