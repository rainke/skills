/**
 * Regression tests for symlink installs when canonical and agent paths match.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  lstat,
  readFile,
  symlink,
  readdir,
  readlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyInstalledSkillForAgent,
  getRepositorySkillPath,
  installSkillToRepository,
} from '../src/installer.ts';

async function makeSkillSource(root: string, name: string): Promise<string> {
  const dir = join(root, 'source-skill');
  await mkdir(dir, { recursive: true });
  const skillMd = `---\nname: ${name}\ndescription: test\n---\n`;
  await writeFile(join(dir, 'SKILL.md'), skillMd, 'utf-8');
  return dir;
}

describe('installer symlink regression', () => {
  async function installAndApply(root: string, projectDir: string, skillName: string, agent: any) {
    process.env.XDG_CONFIG_HOME = root;
    const skillDir = await makeSkillSource(root, skillName);
    const installResult = await installSkillToRepository({
      name: skillName,
      description: 'test',
      path: skillDir,
    });
    expect(installResult.success).toBe(true);

    return applyInstalledSkillForAgent(skillName, agent, {
      cwd: projectDir,
      mode: 'symlink',
      global: false,
    });
  }

  it('does not create self-loop when canonical and agent paths match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'self-loop-skill';

    try {
      const result = await installAndApply(root, projectDir, skillName, 'opencode');

      expect(result.success).toBe(true);
      expect(result.symlinkFailed).toBeUndefined();

      const installedPath = getRepositorySkillPath(skillName);
      const stats = await lstat(installedPath);
      expect(stats.isSymbolicLink()).toBe(false);
      expect(stats.isDirectory()).toBe(true);

      const contents = await readFile(join(installedPath, 'SKILL.md'), 'utf-8');
      expect(contents).toContain(`name: ${skillName}`);
    } finally {
      delete process.env.XDG_CONFIG_HOME;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cleans pre-existing self-loop symlink in canonical dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'self-loop-skill';

    try {
      process.env.XDG_CONFIG_HOME = root;
      const canonicalDir = getRepositorySkillPath(skillName);
      await mkdir(join(root, 'skills'), { recursive: true });
      await symlink(skillName, canonicalDir);
      const preStats = await lstat(canonicalDir);
      expect(preStats.isSymbolicLink()).toBe(true);

      const result = await installAndApply(root, projectDir, skillName, 'opencode');

      expect(result.success).toBe(true);

      const postStats = await lstat(canonicalDir);
      expect(postStats.isSymbolicLink()).toBe(false);
      expect(postStats.isDirectory()).toBe(true);
    } finally {
      delete process.env.XDG_CONFIG_HOME;
      await rm(root, { recursive: true, force: true });
    }
  });

  // Regression test for #293: when agent skills dir is a symlink to canonical dir
  it('handles agent skills dir being a symlink to canonical dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'symlinked-dir-skill';

    process.env.XDG_CONFIG_HOME = root;
    const canonicalBase = join(root, 'skills');
    await mkdir(canonicalBase, { recursive: true });

    const claudeDir = join(projectDir, '.claude');
    await mkdir(claudeDir, { recursive: true });
    const claudeSkillsDir = join(claudeDir, 'skills');
    await symlink(canonicalBase, claudeSkillsDir);

    try {
      const result = await installAndApply(root, projectDir, skillName, 'claude-code');

      expect(result.success).toBe(true);
      expect(result.symlinkFailed).toBeUndefined();

      const canonicalSkillDir = join(canonicalBase, skillName);
      const stats = await lstat(canonicalSkillDir);
      expect(stats.isDirectory()).toBe(true);

      // It should NOT be a broken symlink - it should be a real directory
      const contents = await readFile(join(canonicalSkillDir, 'SKILL.md'), 'utf-8');
      expect(contents).toContain(`name: ${skillName}`);

      // The skill should also be accessible via the symlinked path
      const claudeSkillDir = join(claudeSkillsDir, skillName);
      const claudeContents = await readFile(join(claudeSkillDir, 'SKILL.md'), 'utf-8');
      expect(claudeContents).toContain(`name: ${skillName}`);

      // There should be no broken symlinks in canonical dir
      const canonicalEntries = await readdir(canonicalBase, { withFileTypes: true });
      for (const entry of canonicalEntries) {
        if (entry.name === skillName) {
          const entryPath = join(canonicalBase, entry.name);
          const entryStats = await lstat(entryPath);
          // Should be a real directory, not a symlink
          expect(entryStats.isDirectory()).toBe(true);
        }
      }
    } finally {
      delete process.env.XDG_CONFIG_HOME;
      await rm(root, { recursive: true, force: true });
    }
  });

  it('applies codex skills into the codex agent directory for global scope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });
    const skillName = 'codex-global-skill';

    try {
      process.env.XDG_CONFIG_HOME = root;
      process.env.HOME = root;
      process.env.CODEX_HOME = join(root, '.codex');

      vi.resetModules();
      const [{ agents: freshAgents }, installerModule] = await Promise.all([
        import('../src/agents.ts'),
        import('../src/installer.ts'),
      ]);
      const codexSkillsDir = freshAgents.codex!.globalSkillsDir!;
      await mkdir(codexSkillsDir, { recursive: true });

      const skillDir = await makeSkillSource(root, skillName);
      const installResult = await installerModule.installSkillToRepository({
        name: skillName,
        description: 'test',
        path: skillDir,
      });
      expect(installResult.success).toBe(true);

      const result = await installerModule.applyInstalledSkillForAgent(skillName, 'codex', {
        cwd: projectDir,
        mode: 'symlink',
        global: true,
      });

      expect(result.success).toBe(true);
      expect(result.symlinkFailed).toBeUndefined();
      expect(result.path).toBe(join(codexSkillsDir, skillName));

      const installedPath = join(codexSkillsDir, skillName);
      const stats = await lstat(installedPath);
      expect(stats.isSymbolicLink()).toBe(true);
      expect(await readlink(installedPath)).toContain('skills/codex-global-skill');
    } finally {
      delete process.env.XDG_CONFIG_HOME;
      delete process.env.HOME;
      delete process.env.CODEX_HOME;
      await rm(root, { recursive: true, force: true });
    }
  });
});
