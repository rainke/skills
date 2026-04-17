import { describe, it, expect, vi } from 'vitest';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';

async function importFreshAgents(tag: string) {
  void tag;
  vi.resetModules();
  return import('../src/agents.ts');
}

describe('agent registry paths', () => {
  const home = homedir();

  describe('built-in agents', () => {
    it('uses ~/.agents/skills for OpenCode global skills', async () => {
      const { agents } = await importFreshAgents('opencode');
      const expected = join(home, '.agents', 'skills');
      expect(agents.opencode!.globalSkillsDir).toBe(expected);
    });

    it('does not use platform-specific OpenCode config paths', async () => {
      const { agents } = await importFreshAgents('opencode-platform');
      expect(agents.opencode!.globalSkillsDir).not.toContain('Library');
      expect(agents.opencode!.globalSkillsDir).not.toContain('Preferences');
      expect(agents.opencode!.globalSkillsDir).not.toContain('AppData');
    });

    it('keeps only the four built-in agents by default', async () => {
      const { builtinAgents, getValidAgentIds } = await importFreshAgents('builtins');
      expect(Object.keys(builtinAgents).sort()).toEqual([
        'claude-code',
        'codex',
        'github-copilot',
        'opencode',
      ]);
      expect(getValidAgentIds().sort()).toEqual(Object.keys(builtinAgents).sort());
    });
  });

  describe('skill lock file path', () => {
    function getSkillLockPath(xdgStateHome: string | undefined, homeDir: string): string {
      if (xdgStateHome) {
        return join(xdgStateHome, 'skills', '.skill-lock.json');
      }
      return join(homeDir, '.agents', '.skill-lock.json');
    }

    it('uses XDG_STATE_HOME when set', () => {
      const result = getSkillLockPath('/custom/state', home);
      expect(result).toBe(join('/custom/state', 'skills', '.skill-lock.json'));
    });

    it('falls back to ~/.agents when XDG_STATE_HOME is not set', () => {
      const result = getSkillLockPath(undefined, home);
      expect(result).toBe(join(home, '.agents', '.skill-lock.json'));
    });
  });

  describe('configured agents', () => {
    it('loads configured agents from ~/.config/skills/config.json and expands ~', async () => {
      const root = await mkdtemp(join(tmpdir(), 'skills-config-'));

      try {
        process.env.XDG_CONFIG_HOME = root;
        await mkdir(join(root, 'skills'), { recursive: true });
        await writeFile(
          join(root, 'skills', 'config.json'),
          JSON.stringify(
            {
              agents: [
                {
                  name: 'cursor',
                  displayName: 'Cursor',
                  projectSkillsDir: '.agents/skills',
                  globalSkillsDir: '~/.cursor/skills',
                },
                {
                  name: 'custom-agent',
                  displayName: 'Custom Agent',
                  projectSkillsDir: '.custom/skills',
                },
              ],
            },
            null,
            2
          )
        );

        const { agents, getUniversalAgents, getNonUniversalAgents } =
          await importFreshAgents('configured');

        expect(agents.cursor!.globalSkillsDir).toBe(join(home, '.cursor', 'skills'));
        expect(agents.cursor!.skillsDir).toBe('.agents/skills');
        expect(getUniversalAgents()).toContain('cursor');
        expect(getNonUniversalAgents()).toContain('custom-agent');
      } finally {
        delete process.env.XDG_CONFIG_HOME;
        await rm(root, { recursive: true, force: true });
      }
    });

    it('ignores configured agents that conflict with built-ins', async () => {
      const root = await mkdtemp(join(tmpdir(), 'skills-config-'));

      try {
        process.env.XDG_CONFIG_HOME = root;
        await mkdir(join(root, 'skills'), { recursive: true });
        await writeFile(
          join(root, 'skills', 'config.json'),
          JSON.stringify({
            agents: [
              {
                name: 'codex',
                displayName: 'Custom Codex',
                projectSkillsDir: '.custom/skills',
              },
            ],
          })
        );

        const { agents } = await importFreshAgents('conflict');
        expect(agents.codex!.displayName).toBe('Codex');
        expect(agents.codex!.skillsDir).toBe('.agents/skills');
      } finally {
        delete process.env.XDG_CONFIG_HOME;
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});
