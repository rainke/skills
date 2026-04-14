import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as p from '@clack/prompts';
import { resolveApplyScope } from './apply.ts';

vi.mock('@clack/prompts', async () => {
  const actual = await vi.importActual<typeof import('@clack/prompts')>('@clack/prompts');
  return {
    ...actual,
    select: vi.fn(),
    cancel: vi.fn(),
  };
});

describe('resolveApplyScope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns explicit global scope without prompting', async () => {
    await expect(resolveApplyScope({ global: true })).resolves.toBe(true);
    expect(vi.mocked(p.select)).not.toHaveBeenCalled();
  });

  it('defaults to project scope in non-interactive mode', async () => {
    await expect(resolveApplyScope({ yes: true })).resolves.toBe(false);
    expect(vi.mocked(p.select)).not.toHaveBeenCalled();
  });

  it('prompts for scope when not specified', async () => {
    vi.mocked(p.select).mockResolvedValueOnce('global' as never);

    await expect(resolveApplyScope({})).resolves.toBe(true);

    expect(vi.mocked(p.select)).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Choose apply scope',
      })
    );
  });
});
