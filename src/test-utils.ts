import { execSync } from 'child_process';
import { join } from 'path';

// const PROJECT_ROOT = join(import.meta.dirname, '..');
const CLI_PATH = join(import.meta.dirname, 'cli.ts');
const NODE_TS_FLAGS = '--experimental-strip-types';

export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export function stripLogo(str: string): string {
  return str
    .split('\n')
    .filter((line) => !line.includes('███') && !line.includes('╔') && !line.includes('╚'))
    .join('\n')
    .replace(/^\n+/, '');
}

export function hasLogo(str: string): boolean {
  return str.includes('███') || str.includes('╔') || str.includes('╚');
}

export function runCli(
  args: string[],
  cwd?: string,
  env?: Record<string, string>,
  timeout?: number
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const output = execSync(`node ${NODE_TS_FLAGS} "${CLI_PATH}" ${args.join(' ')}`, {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : undefined,
      timeout: timeout ?? 30000,
    });
    return { stdout: stripAnsi(output), stderr: '', exitCode: 0 };
  } catch (error: any) {
    const stdout = stripAnsi(error.stdout || '');
    const stderr = stripAnsi(error.stderr || '');
    return {
      stdout: stdout || stderr,
      stderr,
      exitCode: error.status || 1,
    };
  }
}

export function runCliOutput(args: string[], cwd?: string): string {
  const result = runCli(args, cwd);
  return result.stdout || result.stderr;
}

export function runCliWithInput(
  args: string[],
  input: string,
  cwd?: string
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const output = execSync(`node ${NODE_TS_FLAGS} "${CLI_PATH}" ${args.join(' ')}`, {
      encoding: 'utf-8',
      cwd,
      input: input + '\n',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: stripAnsi(output), stderr: '', exitCode: 0 };
  } catch (error: any) {
    const stdout = stripAnsi(error.stdout || '');
    const stderr = stripAnsi(error.stderr || '');
    return {
      stdout: stdout || stderr,
      stderr,
      exitCode: error.status || 1,
    };
  }
}
