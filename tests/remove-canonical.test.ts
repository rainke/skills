import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile, lstat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { removeCommand } from '../src/remove.ts';

describe('removeCommand canonical protection', () => {
  let tempDir: string;
  let oldCwd: string;
  let repositoryDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), 'skills-remove-test-' + Date.now());
    await mkdir(tempDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = tempDir;
    oldCwd = process.cwd();
    process.chdir(tempDir);
    repositoryDir = join(tempDir, 'skills');
    await mkdir(repositoryDir, { recursive: true });
    await mkdir(join(tempDir, '.claude/skills'), { recursive: true });
    await mkdir(join(tempDir, '.continue/skills'), { recursive: true });
  });

  afterEach(async () => {
    process.chdir(oldCwd);
    delete process.env.XDG_CONFIG_HOME;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should remove repository storage and targeted agent links when removing a skill', async () => {
    const skillName = 'test-skill';
    const canonicalPath = join(repositoryDir, skillName);
    const claudePath = join(tempDir, '.claude/skills', skillName);
    const continuePath = join(tempDir, '.continue/skills', skillName);

    await mkdir(canonicalPath, { recursive: true });
    await writeFile(join(canonicalPath, 'SKILL.md'), '# Test');
    await symlink(canonicalPath, claudePath, 'junction');
    await symlink(canonicalPath, continuePath, 'junction');

    await removeCommand([skillName], { agent: ['claude-code'], yes: true });

    await expect(lstat(claudePath)).rejects.toThrow();
    await expect(lstat(continuePath)).rejects.toThrow();
    await expect(lstat(canonicalPath)).rejects.toThrow();
  });

  it('should remove repository storage even when the skill was only linked to one agent', async () => {
    const skillName = 'test-skill-2';
    const canonicalPath = join(repositoryDir, skillName);
    const claudePath = join(tempDir, '.claude/skills', skillName);

    await mkdir(canonicalPath, { recursive: true });
    await writeFile(join(canonicalPath, 'SKILL.md'), '# Test');
    await symlink(canonicalPath, claudePath, 'junction');

    await removeCommand([skillName], { agent: ['claude-code'], yes: true });

    await expect(lstat(claudePath)).rejects.toThrow();
    await expect(lstat(canonicalPath)).rejects.toThrow();
  });
});
