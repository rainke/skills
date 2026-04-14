import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from './test-utils.ts';
import { parseListOptions } from './list.ts';

describe('list command', () => {
  let testDir: string;
  let repositoryDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-list-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = testDir;
    repositoryDir = join(testDir, 'skills');
    mkdirSync(repositoryDir, { recursive: true });
  });

  afterEach(() => {
    delete process.env.XDG_CONFIG_HOME;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  function writeLock(skills: Record<string, { source: string; sourceUrl?: string }>) {
    const lockPath = join(repositoryDir, 'skill-lock.json');
    const now = new Date().toISOString();
    writeFileSync(
      lockPath,
      JSON.stringify(
        {
          version: 4,
          skills: Object.fromEntries(
            Object.entries(skills).map(([name, entry]) => [
              name,
              {
                source: entry.source,
                sourceType: 'github',
                sourceUrl: entry.sourceUrl ?? `https://github.com/${entry.source}`,
                skillFolderHash: 'test-hash',
                installedAt: now,
                updatedAt: now,
              },
            ])
          ),
        },
        null,
        2
      )
    );
  }

  function writeRepositorySkill(name: string, description: string = `${name} description`) {
    const skillDir = join(repositoryDir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: ${name}
description: ${description}
---

# ${name}
`
    );
  }

  function writeAgentSkill(
    agentDir: string,
    name: string,
    description: string = `${name} description`
  ) {
    const skillDir = join(testDir, agentDir, 'skills', name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: ${name}
description: ${description}
---

# ${name}
`
    );
  }

  describe('parseListOptions', () => {
    it('should parse empty args', () => {
      const options = parseListOptions([]);
      expect(options).toEqual({});
    });

    it('should parse -g flag', () => {
      const options = parseListOptions(['-g']);
      expect(options.global).toBe(true);
    });

    it('should parse --global flag', () => {
      const options = parseListOptions(['--global']);
      expect(options.global).toBe(true);
    });

    it('should parse -a flag with single agent', () => {
      const options = parseListOptions(['-a', 'claude-code']);
      expect(options.agent).toEqual(['claude-code']);
    });

    it('should parse --agent flag with single agent', () => {
      const options = parseListOptions(['--agent', 'cursor']);
      expect(options.agent).toEqual(['cursor']);
    });

    it('should parse -a flag with multiple agents', () => {
      const options = parseListOptions(['-a', 'claude-code', 'cursor', 'codex']);
      expect(options.agent).toEqual(['claude-code', 'cursor', 'codex']);
    });

    it('should parse combined flags', () => {
      const options = parseListOptions(['-g', '-a', 'claude-code', 'cursor']);
      expect(options.global).toBe(true);
      expect(options.agent).toEqual(['claude-code', 'cursor']);
    });

    it('should parse --json flag', () => {
      const options = parseListOptions(['--json']);
      expect(options.json).toBe(true);
    });

    it('should parse combined --json and -g flags', () => {
      const options = parseListOptions(['-g', '--json']);
      expect(options.global).toBe(true);
      expect(options.json).toBe(true);
    });

    it('should stop collecting agents at next flag', () => {
      const options = parseListOptions(['-a', 'claude-code', '-g']);
      expect(options.agent).toEqual(['claude-code']);
      expect(options.global).toBe(true);
    });
  });

  describe('CLI integration', () => {
    it('should run list command', () => {
      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('No installed skills found.');
      expect(result.exitCode).toBe(0);
    });

    it('should run ls alias', () => {
      const result = runCli(['ls'], testDir);
      expect(result.stdout).toContain('No installed skills found.');
      expect(result.exitCode).toBe(0);
    });

    it('should output empty JSON array when no skills', () => {
      const result = runCli(['list', '--json'], testDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed).toEqual([]);
    });

    it('should output valid JSON with --json flag', () => {
      writeRepositorySkill('json-skill', 'A skill for JSON testing');
      writeLock({
        'json-skill': {
          source: 'acme/json-skills',
        },
      });

      const result = runCli(['list', '--json'], testDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
      expect(parsed[0].name).toBe('json-skill');
      expect(parsed[0].source).toBe('acme/json-skills');
      expect(parsed[0].sourceUrl).toContain('acme/json-skills');
      // No ANSI codes in JSON output
      expect(result.stdout).not.toMatch(/\x1b\[/);
    });

    it('should output multiple skills as JSON array', () => {
      writeRepositorySkill('skill-alpha', 'Alpha');
      writeRepositorySkill('skill-beta', 'Beta');
      writeLock({
        'skill-alpha': { source: 'acme/alpha-skills' },
        'skill-beta': { source: 'acme/beta-skills' },
      });

      const result = runCli(['list', '--json'], testDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed.length).toBe(2);
      const names = parsed.map((s: any) => s.name);
      expect(names).toContain('skill-alpha');
      expect(names).toContain('skill-beta');
    });

    it('should show message when no project skills found', () => {
      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('No installed skills found.');
      expect(result.exitCode).toBe(0);
    });

    it('should list installed skills from the repository lock', () => {
      writeRepositorySkill('test-skill', 'A test skill for listing');
      writeLock({
        'test-skill': { source: 'acme/test-skills' },
      });

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('test-skill');
      expect(result.stdout).toContain('Installed Skills');
      expect(result.stdout).toContain('acme/test-skills');
      expect(result.exitCode).toBe(0);
    });

    it('should list multiple installed skills from the lock', () => {
      writeRepositorySkill('skill-one', 'First skill');
      writeRepositorySkill('skill-two', 'Second skill');
      writeLock({
        'skill-one': { source: 'acme/one' },
        'skill-two': { source: 'acme/two' },
      });

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('skill-one');
      expect(result.stdout).toContain('skill-two');
      expect(result.stdout).toContain('Installed Skills');
      expect(result.exitCode).toBe(0);
    });

    it('should still list installed skills when -g is provided without an agent filter', () => {
      writeRepositorySkill('installed-skill', 'Installed skill');
      writeLock({
        'installed-skill': { source: 'acme/repo' },
      });
      const result = runCli(['list', '-g'], testDir);
      expect(result.stdout).toContain('Installed Skills');
      expect(result.stdout).toContain('installed-skill');
    });

    it('should show error for invalid agent filter', () => {
      const result = runCli(['list', '-a', 'invalid-agent'], testDir);
      expect(result.stdout).toContain('Invalid agents');
      expect(result.stdout).toContain('invalid-agent');
      expect(result.exitCode).toBe(1);
    });

    it('should filter by valid agent', () => {
      writeRepositorySkill('test-skill', 'A test skill');
      const repoSkillDir = join(repositoryDir, 'test-skill');
      mkdirSync(join(testDir, '.claude', 'skills'), { recursive: true });
      symlinkSync(repoSkillDir, join(testDir, '.claude', 'skills', 'test-skill'));

      const result = runCli(['list', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('test-skill');
      expect(result.stdout).toContain('Project Skills');
      expect(result.exitCode).toBe(0);
    });

    it('should ignore directories without SKILL.md', () => {
      writeAgentSkill('.claude', 'valid-skill', 'Valid skill');
      const invalidDir = join(testDir, '.claude', 'skills', 'invalid-skill');
      mkdirSync(invalidDir, { recursive: true });
      writeFileSync(join(invalidDir, 'README.md'), '# Not a skill');

      const result = runCli(['list', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('valid-skill');
      expect(result.stdout).not.toContain('invalid-skill');
      expect(result.exitCode).toBe(0);
    });

    it('should handle SKILL.md with missing frontmatter', () => {
      writeAgentSkill('.claude', 'valid-skill', 'Valid skill');
      const invalidDir = join(testDir, '.claude', 'skills', 'invalid-skill');
      mkdirSync(invalidDir, { recursive: true });
      writeFileSync(join(invalidDir, 'SKILL.md'), '# Invalid\nNo frontmatter here');

      const result = runCli(['list', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('valid-skill');
      expect(result.stdout).not.toContain('invalid-skill');
      expect(result.exitCode).toBe(0);
    });

    it('should show skill path', () => {
      writeAgentSkill('.claude', 'test-skill', 'A test skill');

      const result = runCli(['list', '-a', 'claude-code'], testDir);
      expect(result.stdout).toMatch(/\.claude[/\\]skills[/\\]test-skill/);
    });
  });

  describe('help output', () => {
    it('should include list command in help', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('list, ls');
      expect(result.stdout).toContain('List installed skills');
    });

    it('should include list options in help', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('List Options:');
      expect(result.stdout).toContain('-g, --global');
      expect(result.stdout).toContain('-a, --agent');
    });

    it('should include list examples in help', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('skills list');
      expect(result.stdout).toContain('skills ls -g');
      expect(result.stdout).toContain('skills ls -a claude-code');
    });
  });

  describe('banner', () => {
    it('should include list command in banner', () => {
      const result = runCli([]);
      expect(result.stdout).toContain('npx skills list');
      expect(result.stdout).toContain('List installed skills');
    });
  });
});
