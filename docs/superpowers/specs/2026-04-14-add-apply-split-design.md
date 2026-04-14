# Design: Split `skills add` into `skills add` + `skills apply`

Date: 2026-04-14

## Summary

Split the monolithic `skills add` command into two separate commands:
- `skills add` — install skills to a central repository (`~/.config/skills`)
- `skills apply` — apply installed skills to specific agents by creating symlinks/copies

The `skills add` command supports an `--apply` flag that runs the apply flow immediately after installation.

## Motivation

Currently, `skills add` performs two distinct responsibilities:
1. Download/discover/install skill files to a canonical location
2. Create symlinks/copies into agent-specific directories

These responsibilities should be separated so that:
- Skills can be installed once and applied to multiple agents independently
- The installation and application steps can be composed (e.g., install first, apply later)
- The workflow is clearer: "add" = put in repository, "apply" = wire to agent

## Command Interface

### `skills add <source>`

**Responsibility**: Download/clone → discover → install to `~/.config/skills` → update lock file

| Parameter | Description |
|-----------|-------------|
| `<source>` | Skill source (GitHub repo, URL, local path) |
| `-s, --skill <skills>` | Specify skills (skip interactive selection) |
| `-l, --list` | List available skills only |
| `--all` | Install all discovered skills |
| `--full-depth` | Search all subdirectories |
| `--copy` | Use copy instead of symlink |
| `--apply` | Run apply flow after installation |
| `-a, --agent <agents>` | With `--apply`, specify target agents |
| `-y, --yes` | Skip confirmation |
| `--dangerously-accept-openclaw-risks` | Accept OpenClaw risks |

**Removed parameters** (compared to current `skills add`):
- `-g, --global` — add is always global (installs to `~/.config/skills`)

**Behavior changes**:
- No longer prompts to select agents (unless `--apply` is used)
- Only writes to `~/.config/skills/skill-lock.json`
- With `--apply`, invokes the apply flow after installation using the same parameters and logic as `skills apply`

### `skills apply`

**Responsibility**: Read installed skills → select skills and agents → create symlinks/copies into agent directories

| Parameter | Description |
|-----------|-------------|
| `-s, --skill <skills>` | Apply specific skills by name (e.g., `brainstorming`) |
| `--source <source>` | Apply all skills from a specific source (e.g., `obra/superpowers`) |
| `-a, --agent <agents>` | Specify target agents |
| `--all` | Apply all skills to all agents |
| `--copy` | Use copy instead of symlink |
| `-g, --global` | Global vs project-level apply |
| `-y, --yes` | Skip confirmation |

**Examples**:
```bash
# Apply the brainstorming skill to codex
skills apply --skill brainstorming --agent codex

# Apply all skills from obra/superpowers to codex
skills apply --source obra/superpowers --agent codex

# Interactive selection
skills apply
```

**Behavior**:
1. Read `~/.config/skills/skill-lock.json` to get installed skills list
2. If `--skill` not specified, interactively select which skills to apply
3. If `--agent` not specified, interactively select target agents
4. For each (skill, agent) pair: create symlink or copy to agent's skillsDir
5. Update the relevant lock file (global or project-level)

## Data Structures

### New lock file: `~/.config/skills/skill-lock.json`

```json
{
  "version": 4,
  "skills": {
    "brainstorming": {
      "source": "obra/superpowers",
      "sourceType": "github",
      "sourceUrl": "https://github.com/obra/superpowers",
      "ref": "main",
      "skillPath": "skills/brainstorming",
      "skillFolderHash": "abc123...",
      "installedAt": "2026-04-14T10:00:00Z",
      "updatedAt": "2026-04-14T10:00:00Z"
    },
    "writing-plans": {
      "source": "obra/superpowers",
      "sourceType": "github",
      "sourceUrl": "https://github.com/obra/superpowers",
      "ref": "main",
      "skillPath": "skills/writing-plans",
      "skillFolderHash": "def456...",
      "installedAt": "2026-04-14T10:00:00Z",
      "updatedAt": "2026-04-14T10:00:00Z"
    }
  }
}
```

**Differences from old format**:
- Key changed from incrementing index to skill name (enables lookup by name)
- Removed `pluginName` field
- Path changed to `~/.config/skills/skill-lock.json`

### Directory structure

```
~/.config/skills/
├── skill-lock.json
├── brainstorming/
│   └── SKILL.md (and other skill files)
├── writing-plans/
│   └── SKILL.md
└── ...
```

## Core Flows

### `skills add` flow

```
skills add obra/superpowers
  │
  ▼
Parse source (GitHub/GitLab/local/well-known)
  │
  ▼
Download/clone skill files
  │
  ▼
discoverSkills() — find available skills
  │
  ├── --list? → list skills, exit
  │
  ▼
Select skills (--skill / interactive / --all)
  │
  ▼
Install to ~/.config/skills/<skill-name>/
(copy files, canonical location)
  │
  ▼
Update ~/.config/skills/skill-lock.json
  │
  ├── --apply? → proceed to apply flow
  │
  ▼
Done
```

### `skills apply` flow

```
skills apply [--skill x] [--source y] [--agent z]
  │
  ▼
Read ~/.config/skills/skill-lock.json
  │
  ▼
Determine skills to apply
(--skill specified / --source filter / interactive / --all)
  │
  ▼
Determine target agents
(--agent specified / interactive / --all)
  │
  ▼
For each (skill, agent) pair:
  - Verify ~/.config/skills/<skill-name>/ exists
  - Create symlink or copy to agent's skillsDir
    (e.g., ~/.claude/skills/<skill-name> → ~/.config/skills/<skill-name>)
  │
  ▼
Update agent-side lock file
(global ~/.agents/.skill-lock.json or project skills-lock.json)
  │
  ▼
Done
```

### `skills add --apply` flow

```
skills add obra/superpowers --apply --agent codex
  │
  ▼
[Execute full add flow]
  │
  ▼
Pass newly installed skills into apply flow
(skill list = just-installed skills, agent = --agent or interactive)
  │
  ▼
[Execute apply flow]
  │
  ▼
Done
```

### Key implementation details

1. **Symlink target change**: symlinks point from agent directory → `~/.config/skills/<name>` instead of `~/.agents/skills/<name>`
2. **Apply-side lock file**: apply writes to the existing agent-side lock files (`~/.agents/.skill-lock.json` for global, `skills-lock.json` for project). These lock files track which skills are applied to which agents, recording the source, hash, and path info so that `skills update` and `skills remove` can work correctly. The format remains compatible with the current lock file structure for the applied entries.
3. **Add no longer writes agent lock files**: add only writes `~/.config/skills/skill-lock.json`
4. **Two distinct lock files**: `~/.config/skills/skill-lock.json` (the "repository" lock) tracks what's installed; agent-side lock files track what's applied to each context. These are separate concerns.

## Affected Existing Features

### `skills remove`

- Remove skill files from `~/.config/skills/<name>/` and update `~/.config/skills/skill-lock.json`
- Automatically clean up symlinks in all agent directories pointing to the removed skill
- Consider adding `skills unapply` (or `skills remove --unapply-only`): only remove agent symlinks but keep skill in `~/.config/skills`

### `skills list`

- Default: list all installed skills from `~/.config/skills/skill-lock.json`
- `--agent <agent>`: list skills applied to a specific agent
- Or differentiate via subcommand: `skills list` vs `skills list --applied`

### `skills update`

- Check for new versions of skills in `~/.config/skills/skill-lock.json`
- Update files in `~/.config/skills/<name>/` and the lock file
- After update, do not automatically re-apply; support `--apply` flag

### `skills experimental_install`

- Change to call the apply flow: read installed skills from `~/.config/skills` and apply to the project

### `skills experimental_sync`

- Not significantly affected by this change; keep as-is

## Error Handling

| Scenario | Handling |
|----------|----------|
| `skills apply` but `~/.config/skills/skill-lock.json` doesn't exist | Error: "No skills installed. Run `skills add` first." |
| `skills apply --skill foo` but foo not installed | Error: "Skill 'foo' not installed" with list of available skills |
| `skills apply --source bar` but no matching source | Error: "No skills found for source 'bar'" with list of available sources |
| `~/.config/skills/<name>/` exists but not in lock file | Skip (orphan directory), optionally prompt to clean up |
| Dangling symlink (target deleted but agent symlink remains) | Detect and prompt to re-apply |
| Name conflict during `skills add` (same-name skill already installed) | Prompt user whether to overwrite/update |
| `skills add --apply` but add fails | Do not enter apply flow; exit with error |

## Backward Compatibility

- Old path `~/.agents/skills/` and old lock file `~/.agents/.skill-lock.json` are not read or written
- If users have both old and new installations, the two systems run independently without conflict
- `skills apply` only reads from `~/.config/skills/`, not old lock files
- No automatic migration from old to new paths

## Implementation Approach: Minimal Split (Plan A)

### New files
- `src/apply.ts` — apply command logic

### Modified files
- `src/add.ts` — remove agent selection/application logic, add `--apply` support
- `src/skill-lock.ts` — new lock file format and path (`~/.config/skills/skill-lock.json`)
- `src/installer.ts` — adjust symlink targets to point to `~/.config/skills/<name>`
- `src/constants.ts` — add new path constant for `~/.config/skills`
- `src/cli.ts` — register `apply` subcommand
- `src/remove.ts` — adjust to use new paths
- `src/list.ts` — adjust to show skills from new lock file by default
- `src/local-lock.ts` — adjust apply-side lock file tracking

### Shared functions
- Skill discovery, source parsing, git clone — unchanged, shared between add and apply
- Symlink/copy logic in `installer.ts` — shared, called by apply
