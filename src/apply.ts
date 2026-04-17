import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
  agents,
  detectInstalledAgents,
  getAgentConfig,
  getUniversalAgents,
  getValidAgentIds,
} from './agents.ts';
import { applyInstalledSkillForAgent, type InstallMode } from './installer.ts';
import { getAllLockedSkills, type SkillLockEntry } from './skill-lock.ts';
import type { AgentType } from './types.ts';

export interface ApplyOptions {
  skill?: string[];
  source?: string[];
  agent?: string[];
  all?: boolean;
  copy?: boolean;
  global?: boolean;
  yes?: boolean;
}

export async function resolveApplyScope(options: ApplyOptions): Promise<boolean> {
  if (options.global !== undefined) {
    return options.global;
  }

  if (options.yes) {
    return false;
  }

  const selected = await p.select({
    message: 'Choose apply scope',
    options: [
      {
        value: 'project',
        label: 'Project',
        hint: 'Apply into the current project directory',
      },
      {
        value: 'global',
        label: 'Global',
        hint: 'Apply into the home-directory agent location',
      },
    ],
  });

  if (p.isCancel(selected)) {
    p.cancel('Apply cancelled');
    process.exit(0);
  }

  return selected === 'global';
}

function ensureUniversalAgents(targetAgents: AgentType[]): AgentType[] {
  const result = [...targetAgents];
  for (const universalAgent of getUniversalAgents()) {
    if (!result.includes(universalAgent)) {
      result.push(universalAgent);
    }
  }
  return result;
}

function matchesSource(entry: SkillLockEntry, sourceFilters: string[]): boolean {
  return sourceFilters.some((source) => {
    const normalized = source.toLowerCase();
    return (
      entry.source.toLowerCase() === normalized ||
      entry.sourceUrl.toLowerCase() === normalized ||
      entry.source.toLowerCase().includes(normalized) ||
      entry.sourceUrl.toLowerCase().includes(normalized)
    );
  });
}

async function resolveTargetAgents(options: ApplyOptions): Promise<AgentType[]> {
  const validAgents = getValidAgentIds() as AgentType[];

  if (options.all) {
    return validAgents;
  }

  if (options.agent?.includes('*')) {
    return validAgents;
  }

  if (options.agent && options.agent.length > 0) {
    const invalidAgents = options.agent.filter(
      (agent) => !validAgents.includes(agent as AgentType)
    );
    if (invalidAgents.length > 0) {
      p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
      p.log.info(`Valid agents: ${validAgents.join(', ')}`);
      process.exit(1);
    }
    return options.agent as AgentType[];
  }

  const detectedAgents = await detectInstalledAgents();
  if (options.yes) {
    return detectedAgents.length > 0 ? ensureUniversalAgents(detectedAgents) : validAgents;
  }

  const choices = validAgents
    .filter((agent) => !options.global || getAgentConfig(agent).globalSkillsDir !== undefined)
    .map((agent) => ({
      value: agent,
      label: getAgentConfig(agent).displayName,
      hint: options.global
        ? getAgentConfig(agent).globalSkillsDir || ''
        : getAgentConfig(agent).skillsDir,
    }));

  const selected = await p.multiselect({
    message: `Select agents to apply skills to ${pc.dim('(space to toggle)')}`,
    options: choices as any,
    required: true,
  });

  if (p.isCancel(selected)) {
    p.cancel('Apply cancelled');
    process.exit(0);
  }

  return selected as AgentType[];
}

export async function applyInstalledSkills(
  skillNames: string[],
  options: ApplyOptions = {}
): Promise<void> {
  if (skillNames.length === 0) {
    p.log.warn('No installed skills selected to apply.');
    return;
  }

  options.global = await resolveApplyScope(options);

  const targetAgents = await resolveTargetAgents(options);
  const installMode: InstallMode = options.copy ? 'copy' : 'symlink';
  const results: Array<{
    skill: string;
    agent: AgentType;
    success: boolean;
    path: string;
    error?: string;
    symlinkFailed?: boolean;
  }> = [];

  const spinner = p.spinner();
  spinner.start('Applying skills...');

  for (const skillName of skillNames) {
    for (const agent of targetAgents) {
      const result = await applyInstalledSkillForAgent(skillName, agent, {
        global: options.global,
        mode: installMode,
      });
      results.push({
        skill: skillName,
        agent,
        success: result.success,
        path: result.path,
        error: result.error,
        symlinkFailed: result.symlinkFailed,
      });
    }
  }

  spinner.stop('Apply complete');

  const successfulPairs = results.filter((result) => result.success);
  const failedPairs = results.filter((result) => !result.success);

  if (successfulPairs.length > 0) {
    const uniqueSkills = new Set(successfulPairs.map((result) => result.skill));
    p.log.info(
      `Applied ${pc.cyan(String(uniqueSkills.size))} skill${uniqueSkills.size !== 1 ? 's' : ''} to ${pc.cyan(String(targetAgents.length))} agent${targetAgents.length !== 1 ? 's' : ''}`
    );

    const scopeLabel = options.global ? 'global' : 'project';
    p.log.info(
      `Applied to ${pc.cyan(scopeLabel)} scope${options.global ? '' : pc.dim(' (use --global for home-directory installs)')}`
    );

    const uniqueTargets = Array.from(
      new Map(
        successfulPairs.map((result) => [
          `${result.agent}:${result.path}`,
          { agent: result.agent, path: result.path },
        ])
      ).values()
    );

    if (uniqueTargets.length === 1) {
      p.log.info(`Target: ${pc.dim(uniqueTargets[0]!.path)}`);
    } else {
      for (const target of uniqueTargets) {
        p.log.message(
          `  ${pc.cyan(getAgentConfig(target.agent).displayName)} ${pc.dim('->')} ${pc.dim(target.path)}`
        );
      }
    }
  }

  for (const failed of failedPairs) {
    p.log.message(
      `  ${pc.red('✗')} ${failed.skill} -> ${getAgentConfig(failed.agent).displayName}: ${pc.dim(failed.error || 'Unknown error')}`
    );
  }

  const copiedFallbacks = results.filter((result) => result.symlinkFailed);
  if (copiedFallbacks.length > 0) {
    p.log.warn(
      `Symlink creation failed for ${copiedFallbacks.length} target(s); copied files instead.`
    );
  }
}

export async function runApply(args: string[], options: ApplyOptions = {}): Promise<void> {
  if (options.all) {
    options.skill = ['*'];
    options.agent = ['*'];
    options.yes = true;
  }

  const installedSkills = await getAllLockedSkills();
  const installedSkillNames = Object.keys(installedSkills).sort();

  if (installedSkillNames.length === 0) {
    p.log.error('No skills installed. Run `skills add` first.');
    process.exit(1);
  }

  let skillNames: string[];

  if (options.skill?.includes('*')) {
    skillNames = installedSkillNames;
  } else if (options.skill && options.skill.length > 0) {
    const missing = options.skill.filter((skill) => !(skill in installedSkills));
    if (missing.length > 0) {
      p.log.error(`Skill not installed: ${missing.join(', ')}`);
      p.log.info(`Available skills: ${installedSkillNames.join(', ')}`);
      process.exit(1);
    }
    skillNames = options.skill;
  } else if (options.source && options.source.length > 0) {
    skillNames = installedSkillNames.filter((skillName) =>
      matchesSource(installedSkills[skillName]!, options.source!)
    );
    if (skillNames.length === 0) {
      p.log.error(`No skills found for source '${options.source.join(', ')}'`);
      process.exit(1);
    }
  } else if (options.yes) {
    skillNames = installedSkillNames;
  } else {
    const selected = await p.multiselect({
      message: `Select skills to apply ${pc.dim('(space to toggle)')}`,
      options: installedSkillNames.map((skillName) => ({
        value: skillName,
        label: skillName,
        hint: installedSkills[skillName]?.source,
      })),
      required: true,
    });

    if (p.isCancel(selected)) {
      p.cancel('Apply cancelled');
      process.exit(0);
    }

    skillNames = selected as string[];
  }

  await applyInstalledSkills(skillNames, options);
}

export function parseApplyOptions(args: string[]): ApplyOptions {
  const options: ApplyOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-s' || arg === '--skill') {
      options.skill = options.skill || [];
      while (i + 1 < args.length && !args[i + 1]!.startsWith('-')) {
        options.skill.push(args[++i]!);
      }
    } else if (arg === '--source') {
      options.source = options.source || [];
      while (i + 1 < args.length && !args[i + 1]!.startsWith('-')) {
        options.source.push(args[++i]!);
      }
    } else if (arg === '-a' || arg === '--agent') {
      options.agent = options.agent || [];
      while (i + 1 < args.length && !args[i + 1]!.startsWith('-')) {
        options.agent.push(args[++i]!);
      }
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '--copy') {
      options.copy = true;
    } else if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    }
  }

  return options;
}
