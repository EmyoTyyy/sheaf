import type { GitFileState, GitStatus } from '@shared/types'
import { fail } from './errors'
import { run, type RunResult } from './process-runner'

const TIMEOUT_MS = 30_000

/** Environment that stops git from opening editors or prompting for input. */
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_EDITOR: 'true',
  LC_ALL: 'C'
}

async function git(root: string, args: string[]): Promise<RunResult> {
  const result = await run('git', args, { cwd: root, env: GIT_ENV, timeoutMs: TIMEOUT_MS })
  if (result.spawnError) {
    if (result.spawnError.code === 'ENOENT') {
      fail(
        'GIT_MISSING',
        'Git is not installed',
        'Sheaf could not find the git command on this computer.',
        'Install git to use the source-control panel. Everything else works without it.'
      )
    }
    fail('GIT_FAILED', 'Git could not be started', result.spawnError.message)
  }
  return result
}

async function gitOrThrow(root: string, args: string[]): Promise<string> {
  const result = await git(root, args)
  if (result.exitCode !== 0) {
    fail(
      'GIT_FAILED',
      `git ${args[0]} failed`,
      (result.stderr || result.stdout).trim() || `git exited with code ${result.exitCode}.`,
      undefined,
      result.stderr
    )
  }
  return result.stdout
}

export async function getStatus(root: string): Promise<GitStatus> {
  const check = await run('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: root,
    env: GIT_ENV,
    timeoutMs: 10_000
  })

  if (check.spawnError || check.exitCode !== 0) {
    return {
      isRepo: false,
      branch: null,
      detached: false,
      ahead: 0,
      behind: 0,
      files: [],
      hasRemote: false
    }
  }

  const output = await gitOrThrow(root, [
    'status',
    '--porcelain=v2',
    '--branch',
    '--untracked-files=normal'
  ])

  const status: GitStatus = {
    isRepo: true,
    branch: null,
    detached: false,
    ahead: 0,
    behind: 0,
    files: [],
    hasRemote: false
  }

  for (const line of output.split('\n')) {
    if (!line) continue

    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim()
      status.detached = head === '(detached)'
      status.branch = status.detached ? null : head
      continue
    }
    if (line.startsWith('# branch.upstream ')) {
      status.hasRemote = true
      continue
    }
    if (line.startsWith('# branch.ab ')) {
      const ab = line.slice('# branch.ab '.length).trim().split(' ')
      status.ahead = Math.abs(Number.parseInt(ab[0] ?? '0', 10)) || 0
      status.behind = Math.abs(Number.parseInt(ab[1] ?? '0', 10)) || 0
      continue
    }

    const kind = line[0]
    if (kind === '1' || kind === '2') {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const parts = line.split(' ')
      const xy = parts[1]
      const rest = parts.slice(kind === '1' ? 8 : 9).join(' ')
      const filePath = kind === '2' ? rest.split('\t')[0] : rest
      const indexState = xy[0]
      const worktreeState = xy[1]

      if (indexState !== '.') {
        status.files.push({
          path: filePath,
          state: mapState(indexState),
          staged: true
        })
      }
      if (worktreeState !== '.') {
        status.files.push({
          path: filePath,
          state: mapState(worktreeState),
          staged: false
        })
      }
      continue
    }
    if (kind === 'u') {
      const parts = line.split(' ')
      status.files.push({
        path: parts.slice(10).join(' '),
        state: 'conflicted',
        staged: false
      })
      continue
    }
    if (kind === '?') {
      status.files.push({ path: line.slice(2), state: 'untracked', staged: false })
    }
  }

  status.files.sort((a, b) => a.path.localeCompare(b.path))
  return status
}

function mapState(code: string): GitFileState {
  switch (code) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'added'
    case 'U':
      return 'conflicted'
    default:
      return 'modified'
  }
}

export async function getDiff(root: string, relativePath: string, staged: boolean): Promise<string> {
  const args = ['diff', '--no-color']
  if (staged) args.push('--cached')
  args.push('--', relativePath)
  const result = await git(root, args)
  if (result.exitCode !== 0 && !result.stdout) {
    // An untracked file has no diff; show its content as additions instead.
    const show = await run('git', ['status', '--porcelain=v1', '--', relativePath], {
      cwd: root,
      env: GIT_ENV,
      timeoutMs: 10_000
    })
    if (show.stdout.startsWith('??')) return ''
    fail('GIT_FAILED', 'Could not read the diff', result.stderr.trim() || 'git diff failed.')
  }
  return result.stdout
}

export async function stage(root: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await gitOrThrow(root, ['add', '--', ...paths])
}

export async function unstage(root: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await gitOrThrow(root, ['restore', '--staged', '--', ...paths])
}

export async function commit(root: string, message: string): Promise<string> {
  const trimmed = message.trim()
  if (!trimmed) {
    fail('GIT_FAILED', 'Empty commit message', 'Write a message describing the change.')
  }
  return gitOrThrow(root, ['commit', '-m', trimmed])
}

export async function pull(root: string): Promise<string> {
  const result = await git(root, ['pull', '--ff-only'])
  if (result.exitCode !== 0) {
    fail(
      'GIT_FAILED',
      'Pull failed',
      (result.stderr || result.stdout).trim(),
      'Sheaf only performs fast-forward pulls. Resolve the divergence with git on the command line.'
    )
  }
  return result.stdout || result.stderr
}

export async function push(root: string): Promise<string> {
  const result = await git(root, ['push'])
  if (result.exitCode !== 0) {
    fail(
      'GIT_FAILED',
      'Push failed',
      (result.stderr || result.stdout).trim(),
      'Authentication prompts are disabled inside Sheaf. Push from a terminal if credentials are needed.'
    )
  }
  return result.stdout || result.stderr
}

export async function init(root: string): Promise<void> {
  await gitOrThrow(root, ['init'])
}

export interface GitLogEntry {
  hash: string
  author: string
  date: string
  subject: string
}

export async function log(root: string, limit = 20): Promise<GitLogEntry[]> {
  const separator = String.fromCharCode(31)
  const output = await gitOrThrow(root, [
    'log',
    `-${limit}`,
    `--pretty=format:%h${separator}%an${separator}%ar${separator}%s`
  ])
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, author, date, subject] = line.split(separator)
      return { hash, author, date, subject }
    })
}
