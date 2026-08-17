import { spawn, type ChildProcess } from 'node:child_process'

export interface RunOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  onChunk?: (chunk: string, stream: 'stdout' | 'stderr') => void
  /** Resolves with the child so callers can cancel it. */
  onStart?: (child: ChildProcess) => void
  maxOutputBytes?: number
}

export interface RunResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
  /** Set when the executable itself could not be started. */
  spawnError: NodeJS.ErrnoException | null
}

const DEFAULT_MAX_OUTPUT = 8 * 1024 * 1024

/**
 * Runs an executable with an argument array. The shell is never involved, so
 * file names containing spaces or shell metacharacters are inert.
 */
export function run(executable: string, args: string[], options: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let killTimer: NodeJS.Timeout | null = null
    let timeoutTimer: NodeJS.Timeout | null = null

    let child: ChildProcess
    try {
      child = spawn(executable, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      resolve({
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        durationMs: Date.now() - startedAt,
        timedOut: false,
        spawnError: error as NodeJS.ErrnoException
      })
      return
    }

    options.onStart?.(child)

    const finish = (result: Omit<RunResult, 'durationMs'>): void => {
      if (settled) return
      settled = true
      if (killTimer) clearTimeout(killTimer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
      resolve({ ...result, durationMs: Date.now() - startedAt })
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')

    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < maxOutput) stdout += chunk
      options.onChunk?.(chunk, 'stdout')
    })
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < maxOutput) stderr += chunk
      options.onChunk?.(chunk, 'stderr')
    })

    child.on('error', (error) => {
      finish({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        timedOut,
        spawnError: error as NodeJS.ErrnoException
      })
    })

    child.on('close', (code, signal) => {
      finish({ exitCode: code, signal, stdout, stderr, timedOut, spawnError: null })
    })

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true
        killTree(child)
      }, options.timeoutMs)
    }
  })
}

/**
 * Terminates a child and its descendants. LaTeX engines spawn helpers, so
 * killing only the direct child can leave orphans behind.
 */
export function killTree(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return

  if (process.platform === 'win32') {
    // taskkill is the only reliable way to end a process tree on Windows.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      shell: false
    }).on('error', () => child.kill())
    return
  }

  try {
    child.kill('SIGTERM')
  } catch {
    return
  }
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGKILL')
      } catch {
        // Already gone.
      }
    }
  }, 3000).unref()
}
