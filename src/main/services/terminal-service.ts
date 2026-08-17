import { spawn, type ChildProcess } from 'node:child_process'
import type { TerminalChunk, TerminalExit } from '@shared/types'
import { fail } from './errors'
import { killTree } from './process-runner'

/**
 * Runs one user-typed command inside the project directory and streams its
 * output. This is deliberately separate from every other process path in the
 * application: file operations and LaTeX builds never go through a shell,
 * while this one does exactly what the user asked for and nothing implicitly.
 *
 * It is a command runner, not a pseudo-terminal: programs that need an
 * interactive TTY (vim, top, a password prompt) will not work here.
 */

interface Session {
  id: string
  child: ChildProcess
  projectId: string
}

const sessions = new Map<string, Session>()
let sessionCounter = 0

export interface TerminalCallbacks {
  onData: (chunk: TerminalChunk) => void
  onExit: (exit: TerminalExit) => void
}

function shellFor(command: string): { executable: string; args: string[] } {
  if (process.platform === 'win32') {
    const comspec = process.env.ComSpec ?? 'cmd.exe'
    return { executable: comspec, args: ['/d', '/s', '/c', command] }
  }
  const shell = process.env.SHELL ?? '/bin/sh'
  return { executable: shell, args: ['-c', command] }
}

export function runCommand(
  projectId: string,
  cwd: string,
  command: string,
  callbacks: TerminalCallbacks
): string {
  const trimmed = command.trim()
  if (!trimmed) {
    fail('INVALID_NAME', 'Empty command', 'Type a command to run.')
  }
  if (sessions.size > 8) {
    fail(
      'UNKNOWN',
      'Too many commands running',
      'Wait for a running command to finish, or stop one, before starting another.'
    )
  }

  sessionCounter += 1
  const id = `t${sessionCounter}-${Date.now()}`
  const { executable, args } = shellFor(trimmed)

  const child = spawn(executable, args, {
    cwd,
    env: { ...process.env, TERM: 'dumb', GIT_PAGER: 'cat', PAGER: 'cat' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  sessions.set(id, { id, child, projectId })

  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (data: string) =>
    callbacks.onData({ sessionId: id, stream: 'stdout', data })
  )
  child.stderr?.on('data', (data: string) =>
    callbacks.onData({ sessionId: id, stream: 'stderr', data })
  )

  child.on('error', (error) => {
    callbacks.onData({
      sessionId: id,
      stream: 'stderr',
      data: `sheaf: ${(error as NodeJS.ErrnoException).message}\n`
    })
  })

  child.on('close', (code, signal) => {
    sessions.delete(id)
    callbacks.onExit({ sessionId: id, exitCode: code, signal })
  })

  return id
}

export function killSession(sessionId: string): boolean {
  const session = sessions.get(sessionId)
  if (!session) return false
  killTree(session.child)
  return true
}

export function killProjectSessions(projectId: string): void {
  for (const session of sessions.values()) {
    if (session.projectId === projectId) killTree(session.child)
  }
}

export function killAllSessions(): void {
  for (const session of sessions.values()) {
    killTree(session.child)
  }
  sessions.clear()
}
