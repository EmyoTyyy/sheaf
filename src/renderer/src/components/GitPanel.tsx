import { useEffect, useMemo, useState } from 'react'
import type { GitFileStatus } from '@shared/types'
import { api, attempt } from '../lib/ipc'
import { useEditorStore } from '../state/editor-store'
import { useProjectStore } from '../state/project-store'
import { reportError, useUiStore } from '../state/ui-store'
import { Icon, fileIconFor } from './common/Icon'
import { Modal } from './common/Modal'
import './GitPanel.css'

const STATE_LABEL: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflicted: '!',
  ignored: 'I'
}

export function GitPanel(): JSX.Element {
  const projectRef = useProjectStore((state) => state.ref)
  const git = useProjectStore((state) => state.git)
  const refreshGit = useProjectStore((state) => state.refreshGit)
  const openFile = useEditorStore((state) => state.openFile)
  const pushToast = useUiStore((state) => state.pushToast)

  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [diff, setDiff] = useState<{ path: string; text: string; staged: boolean } | null>(null)

  useEffect(() => {
    void refreshGit()
  }, [refreshGit])

  const staged = useMemo(() => (git?.files ?? []).filter((file) => file.staged), [git])
  const unstaged = useMemo(() => (git?.files ?? []).filter((file) => !file.staged), [git])

  if (!git) {
    return <div className="git-panel__empty">Checking for a git repository...</div>
  }

  if (!git.isRepo) {
    return (
      <div className="git-panel__empty">
        <p>
          Source control keeps a history of the project. Each time you commit, git records
          what changed, so an earlier version of any file can be read back or restored.
        </p>
        <p>This project is not a git repository.</p>
        <button
          className="btn"
          onClick={async () => {
            if (!projectRef) return
            const done = await attempt(api.git.init(projectRef.id), reportError)
            if (done !== null) {
              pushToast({ severity: 'success', title: 'Repository created' })
              await refreshGit()
            }
          }}
        >
          Initialise a repository
        </button>
        <p className="git-panel__note">Sheaf works perfectly well without git.</p>
      </div>
    )
  }

  const act = async (
    action: () => Promise<unknown>,
    successTitle?: string
  ): Promise<void> => {
    setBusy(true)
    const result = await action()
    setBusy(false)
    if (result !== null && successTitle) pushToast({ severity: 'success', title: successTitle })
    await refreshGit()
  }

  const showDiff = async (file: GitFileStatus): Promise<void> => {
    if (!projectRef) return
    const text = await attempt(api.git.diff(projectRef.id, file.path, file.staged), reportError)
    if (text === null) return
    setDiff({ path: file.path, text, staged: file.staged })
  }

  const renderFile = (file: GitFileStatus): JSX.Element => (
    <div className="git-file" key={`${file.staged}-${file.path}-${file.state}`}>
      <button
        className="git-file__main"
        title={file.path}
        onClick={() => void openFile(file.path)}
        onDoubleClick={() => void showDiff(file)}
      >
        <Icon name={fileIconFor(file.path)} size={13} />
        <span className="truncate">{file.path}</span>
      </button>
      <button className="git-file__action" title="View diff" onClick={() => void showDiff(file)}>
        <Icon name="outline" size={12} />
      </button>
      <button
        className="git-file__action"
        title={file.staged ? 'Unstage' : 'Stage'}
        disabled={busy}
        onClick={() =>
          void act(() =>
            file.staged
              ? attempt(api.git.unstage(projectRef!.id, [file.path]), reportError)
              : attempt(api.git.stage(projectRef!.id, [file.path]), reportError)
          )
        }
      >
        <Icon name={file.staged ? 'arrow-left' : 'plus'} size={12} />
      </button>
      <span className={`git-file__state git-file__state--${file.state}`}>
        {STATE_LABEL[file.state] ?? '?'}
      </span>
    </div>
  )

  return (
    <div className="git-panel">
      <div className="git-panel__header">
        <Icon name="git" size={13} />
        <span className="truncate">{git.branch ?? 'detached HEAD'}</span>
        {git.ahead > 0 ? <span className="git-panel__count">{git.ahead} ahead</span> : null}
        {git.behind > 0 ? <span className="git-panel__count">{git.behind} behind</span> : null}
        <button
          className="btn btn--ghost btn--icon"
          title="Refresh"
          onClick={() => void refreshGit()}
        >
          <Icon name="refresh" size={12} />
        </button>
      </div>

      <div className="git-panel__actions">
        <button
          className="btn btn--ghost"
          disabled={busy || !git.hasRemote}
          title={git.hasRemote ? 'Pull with fast-forward only' : 'No upstream branch'}
          onClick={() => void act(() => attempt(api.git.pull(projectRef!.id), reportError), 'Pulled')}
        >
          <Icon name="download" size={12} />
          Pull
        </button>
        <button
          className="btn btn--ghost"
          disabled={busy || !git.hasRemote}
          title={git.hasRemote ? 'Push to the upstream branch' : 'No upstream branch'}
          onClick={() => void act(() => attempt(api.git.push(projectRef!.id), reportError), 'Pushed')}
        >
          <Icon name="upload" size={12} />
          Push
        </button>
      </div>

      <div className="git-panel__body">
        <section>
          <h4>
            Staged <span>{staged.length}</span>
            {staged.length > 0 ? (
              <button
                className="git-panel__bulk"
                onClick={() =>
                  void act(() =>
                    attempt(
                      api.git.unstage(projectRef!.id, staged.map((file) => file.path)),
                      reportError
                    )
                  )
                }
              >
                Unstage all
              </button>
            ) : null}
          </h4>
          {staged.length === 0 ? <p className="git-panel__none">Nothing staged.</p> : staged.map(renderFile)}
        </section>

        <section>
          <h4>
            Changes <span>{unstaged.length}</span>
            {unstaged.length > 0 ? (
              <button
                className="git-panel__bulk"
                onClick={() =>
                  void act(() =>
                    attempt(
                      api.git.stage(projectRef!.id, unstaged.map((file) => file.path)),
                      reportError
                    )
                  )
                }
              >
                Stage all
              </button>
            ) : null}
          </h4>
          {unstaged.length === 0 ? (
            <p className="git-panel__none">Working tree is clean.</p>
          ) : (
            unstaged.map(renderFile)
          )}
        </section>
      </div>

      <div className="git-panel__commit">
        <textarea
          className="textarea"
          rows={3}
          placeholder="Commit message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <button
          className="btn btn--primary"
          disabled={busy || !message.trim() || staged.length === 0}
          title={staged.length === 0 ? 'Stage some changes first' : 'Commit staged changes'}
          onClick={async () => {
            await act(
              () => attempt(api.git.commit(projectRef!.id, message), reportError),
              'Committed'
            )
            setMessage('')
          }}
        >
          Commit {staged.length > 0 ? `${staged.length} file${staged.length === 1 ? '' : 's'}` : ''}
        </button>
      </div>

      {diff ? (
        <Modal
          title={diff.path}
          subtitle={diff.staged ? 'Staged changes' : 'Unstaged changes'}
          onClose={() => setDiff(null)}
          width={760}
          tall
        >
          {diff.text ? (
            <pre className="git-diff mono">
              {diff.text.split('\n').map((line, index) => (
                <div key={index} className={`git-diff__line git-diff__line--${lineKind(line)}`}>
                  {line || ' '}
                </div>
              ))}
            </pre>
          ) : (
            <p className="git-panel__none">
              This file is untracked, so git has nothing to compare it against yet.
            </p>
          )}
        </Modal>
      ) : null}
    </div>
  )
}

function lineKind(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'remove'
  if (line.startsWith('diff ') || line.startsWith('index ')) return 'meta'
  return 'context'
}
