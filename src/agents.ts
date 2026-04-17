import { homedir } from 'os';
import { join, normalize } from 'path';
import { existsSync, readFileSync } from 'fs';
import { xdgConfig } from 'xdg-basedir';
import type { AgentConfig, AgentType, ConfiguredAgentInput, SkillsConfig } from './types.ts';

const home = homedir();
// Use xdg-basedir (not env-paths) to match OpenCode behavior on all platforms.
const configHome = process.env.XDG_CONFIG_HOME?.trim() || xdgConfig || join(home, '.config');
const codexHome = process.env.CODEX_HOME?.trim() || join(home, '.codex');
const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude');

export function getOpenClawGlobalSkillsDir(
  homeDir = home,
  pathExists: (path: string) => boolean = existsSync
) {
  if (pathExists(join(homeDir, '.openclaw'))) {
    return join(homeDir, '.openclaw/skills');
  }
  if (pathExists(join(homeDir, '.clawdbot'))) {
    return join(homeDir, '.clawdbot/skills');
  }
  if (pathExists(join(homeDir, '.moltbot'))) {
    return join(homeDir, '.moltbot/skills');
  }
  return join(homeDir, '.openclaw/skills');
}

export function getSkillsConfigPath(): string {
  return join(configHome, 'skills', 'config.json');
}

function expandHomePath(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }

  if (input === '~') {
    return home;
  }

  if (input.startsWith('~/')) {
    return join(home, input.slice(2));
  }

  return input;
}

function normalizeProjectSkillsDir(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }

  return normalize(path.replace(/[\\/]+$/, ''));
}

function normalizeAgentConfig(config: ConfiguredAgentInput): AgentConfig | undefined {
  const name = config.name?.trim();
  const displayName = config.displayName?.trim();
  const projectSkillsDir = normalizeProjectSkillsDir(config.projectSkillsDir);
  const globalSkillsDir = expandHomePath(config.globalSkillsDir?.trim());

  if (!name || !displayName) {
    console.warn(
      `Ignoring invalid agent config in ${getSkillsConfigPath()}: missing name/displayName`
    );
    return undefined;
  }

  if (!projectSkillsDir && !globalSkillsDir) {
    console.warn(
      `Ignoring invalid agent config "${name}" in ${getSkillsConfigPath()}: expected projectSkillsDir or globalSkillsDir`
    );
    return undefined;
  }

  return {
    name,
    displayName,
    skillsDir: projectSkillsDir ?? '.agents/skills',
    globalSkillsDir,
    showInUniversalList: config.showInUniversalList ?? projectSkillsDir === '.agents/skills',
    detectInstalled: async () => true,
    builtin: false,
  };
}

function readSkillsConfig(): SkillsConfig {
  const configPath = getSkillsConfigPath();
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as SkillsConfig;
  } catch (error) {
    console.warn(
      `Failed to read ${configPath}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    return {};
  }
}

export const builtinAgents: Record<string, AgentConfig> = {
  'claude-code': {
    name: 'claude-code',
    displayName: 'Claude Code',
    skillsDir: '.claude/skills',
    globalSkillsDir: join(claudeHome, 'skills'),
    detectInstalled: async () => {
      return existsSync(claudeHome);
    },
    builtin: true,
  },
  codex: {
    name: 'codex',
    displayName: 'Codex',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.agents/skills'),
    detectInstalled: async () => {
      return existsSync(codexHome) || existsSync('/etc/codex');
    },
    builtin: true,
  },
  opencode: {
    name: 'opencode',
    displayName: 'OpenCode',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.agents/skills'),
    detectInstalled: async () => {
      return existsSync(join(configHome, 'opencode'));
    },
    builtin: true,
  },
  'github-copilot': {
    name: 'github-copilot',
    displayName: 'GitHub Copilot',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.agents/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.copilot'));
    },
    builtin: true,
  },
};

function loadConfiguredAgents(): Record<string, AgentConfig> {
  const config = readSkillsConfig();
  const configuredAgents = config.agents ?? [];
  const result: Record<string, AgentConfig> = {};
  const seen = new Set<string>();

  for (const agentInput of configuredAgents) {
    const normalized = normalizeAgentConfig(agentInput);
    if (!normalized) {
      continue;
    }

    if (normalized.name in builtinAgents) {
      console.warn(
        `Ignoring configured agent "${normalized.name}" in ${getSkillsConfigPath()}: conflicts with built-in agent`
      );
      continue;
    }

    if (seen.has(normalized.name)) {
      console.warn(
        `Ignoring duplicate configured agent "${normalized.name}" in ${getSkillsConfigPath()}`
      );
      continue;
    }

    seen.add(normalized.name);
    result[normalized.name] = normalized;
  }

  return result;
}

export const agents: Record<string, AgentConfig> = {
  ...builtinAgents,
  ...loadConfiguredAgents(),
};

export async function detectInstalledAgents(): Promise<AgentType[]> {
  const results = await Promise.all(
    Object.entries(agents).map(async ([type, config]) => ({
      type,
      installed: await config.detectInstalled(),
    }))
  );
  return results.filter((r) => r.installed).map((r) => r.type);
}

export function getAgentConfig(type: AgentType): AgentConfig {
  const config = agents[type];
  if (!config) {
    throw new Error(`Unknown agent: ${type}`);
  }
  return config;
}

export function getValidAgentIds(): AgentType[] {
  return Object.keys(agents);
}

/**
 * Returns agents that use the universal .agents/skills directory.
 * These agents share a common skill location and don't need symlinks.
 * Agents with showInUniversalList: false are excluded.
 */
export function getUniversalAgents(): AgentType[] {
  return (Object.entries(agents) as [AgentType, AgentConfig][])
    .filter(
      ([_, config]) => config.skillsDir === '.agents/skills' && config.showInUniversalList !== false
    )
    .map(([type]) => type);
}

/**
 * Returns agents that use agent-specific skill directories (not universal).
 * These agents need symlinks from the canonical .agents/skills location.
 */
export function getNonUniversalAgents(): AgentType[] {
  return (Object.entries(agents) as [AgentType, AgentConfig][])
    .filter(([_, config]) => config.skillsDir !== '.agents/skills')
    .map(([type]) => type);
}

/**
 * Check if an agent uses the universal .agents/skills directory.
 */
export function isUniversalAgent(type: AgentType): boolean {
  return getAgentConfig(type).skillsDir === '.agents/skills';
}
