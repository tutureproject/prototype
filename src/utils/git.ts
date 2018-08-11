import { spawn } from 'child_process';
import * as fs from 'fs-extra';
import * as minimatch from 'minimatch';
import * as path from 'path';
import * as which from 'which';
import * as parseDiff from 'parse-diff';

import { tutureRoot, loadConfig } from '../config';

/**
 * Check if Git command is available.
 */
export function isGitAvailable() {
  return which.sync('git', { nothrow: true }) !== null;
}

/**
 * Run arbitrary Git commands.
 */
function runGitCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const git = spawn('git', args);
    let stdout = '';
    let stderr = '';

    git.stdout.on('data', (data) => {
      stdout += data;
    });

    git.stderr.on('data', (data) => {
      stderr += data;
    });

    git.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr));
      }
    });
  });
}

/**
 * Initialize a Git repo.
 */
export async function initGit() {
  await runGitCommand(['init']);
}

/**
 * Get an array of Git commit messages.
 */
export async function getGitLogs() {
  try {
    const output = await runGitCommand(['log', '--oneline', '--no-merges']);
    return output.trim().split('\n');
  } catch (err) {
    // Current repo doesn't have any commit yet.
    return [];
  }
}

/**
 * Get all changed files of a given commit.
 */
export async function getGitDiff(commit: string) {
  const output = await runGitCommand(['show', commit, '--name-only']);
  let changedFiles = output.split('\n\n').slice(-1)[0].split('\n');
  changedFiles = changedFiles.slice(0, changedFiles.length - 1);

  const ignoredFiles = loadConfig().ignoredFiles;

  return changedFiles
    // don't track changes of ignored files
    .filter(file => !ignoredFiles.some(pattern => minimatch(path.basename(file), pattern)))
    .map(file => ({ file }));
}

/**
 * Store diff of all commits.
 * @param {string[]} commits Hashes of all commits
 */
export async function storeDiff(commits: string[]) {
  const diffPromises = commits.map(async (commit: string) => {
    const output = await runGitCommand(['show', commit]);
    const diffText = output
      .replace('\n\\ No newline at end of file', '')
      .split('\n\n')
      .slice(-1)[0];
    const diff = parseDiff(diffText);
    return { commit, diff };
  });

  const diffs = await Promise.all(diffPromises);

  fs.writeFileSync(
    path.join(tutureRoot, 'diff.json'),
    JSON.stringify(diffs),
  );
}

/**
 * Generate Git hook for different platforms.
 */
function getGitHook() {
  let tuturePath = path.join(__dirname, '..', '..', 'bin', 'run');
  if (process.platform === 'win32') {
    // Replace all \ with / in the path, as is required in Git hook on windows
    // e.g. C:\foo\bar => C:/foo/bar
    tuturePath = tuturePath.replace(/\\/g, '/');
  }
  return `#!/bin/sh\n${tuturePath} reload\n`;
}

/**
 * Add post-commit Git hook for reloading.
 */
export function appendGitHook() {
  const reloadHook = getGitHook();
  const hookPath = path.join('.git', 'hooks', 'post-commit');
  if (!fs.existsSync(hookPath)) {
    fs.writeFileSync(hookPath, reloadHook, { mode: 0o755 });
  } else if (
    !fs.readFileSync(hookPath).toString().includes('tuture reload')
  ) {
    fs.appendFileSync(hookPath, reloadHook);
  }
}

/**
 * Remove Git hook for reloading.
 */
export function removeGitHook() {
  const reloadHook = getGitHook();
  const hookPath = path.join('.git', 'hooks', 'post-commit');
  if (fs.existsSync(hookPath)) {
    const hook = fs.readFileSync(hookPath).toString();
    if (hook === reloadHook) {
      // Auto-generated by Tuture, so delete it.
      fs.removeSync(hookPath);
    } else {
      fs.writeFileSync(hookPath, hook.replace('tuture reload', ''));
    }
  }
}

/**
 * Append .tuture rule to gitignore.
 * If it's already ignored, do nothing.
 * If .gitignore doesn't exist, create one and add the rule.
 */
export function appendGitignore() {
  const ignoreRules = '# Tuture supporting files\n\n.tuture\n';

  if (!fs.existsSync('.gitignore')) {
    fs.writeFileSync('.gitignore', ignoreRules);
  } else if (
    !fs.readFileSync('.gitignore').toString().includes('.tuture')
  ) {
    fs.appendFileSync('.gitignore', `\n${ignoreRules}`);
  }
}