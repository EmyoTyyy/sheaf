import type {
  BuildProgress,
  BuildResult,
  DeepPartial,
  DefaultAppStatus,
  FileEvent,
  FileNode,
  GitStatus,
  LatexEnvironment,
  OpenFileRequest,
  OpenedProject,
  ProjectIndex,
  ProjectRef,
  ProjectSettings,
  Result,
  SearchQuery,
  SearchResults,
  Settings,
  SyncForwardResult,
  SyncInverseResult,
  TemplateId,
  TemplateInfo,
  TerminalChunk,
  TerminalExit
} from './types'

export interface SystemInfo {
  /** 'linux' | 'darwin' | 'win32' | ... as reported by the main process. */
  platform: string
  versions: { app: string; electron: string; chrome: string; node: string }
  homeDirectory: string
  isPackaged: boolean
}

export interface ReadFilePayload {
  content: string
  mtimeMs: number
  size: number
}

export interface ReadBinaryPayload {
  data: Uint8Array
  mime: string
  size: number
  mtimeMs: number
}

export interface WriteFilePayload {
  mtimeMs: number
  size: number
}

export interface PdfPayload {
  data: Uint8Array
  mtimeMs: number
  path: string
}

export interface GitLogEntry {
  hash: string
  author: string
  date: string
  subject: string
}

export type Unsubscribe = () => void

/** The complete surface the renderer is allowed to reach. */
export interface SheafApi {
  system: {
    info(): Promise<SystemInfo>
    showItemInFolder(absolutePath: string): Promise<Result<void>>
    openPath(absolutePath: string): Promise<Result<void>>
    openExternal(url: string): Promise<Result<void>>
  }

  settings: {
    get(): Promise<Result<Settings>>
    update(patch: DeepPartial<Settings>): Promise<Result<Settings>>
    reset(): Promise<Result<Settings>>
    onChanged(callback: (settings: Settings) => void): Unsubscribe
  }

  projects: {
    listRecent(): Promise<Result<ProjectRef[]>>
    templates(): Promise<Result<TemplateInfo[]>>
    create(options: {
      name: string
      directory?: string
      template: TemplateId
    }): Promise<Result<OpenedProject>>
    open(absolutePath: string): Promise<Result<OpenedProject>>
    openDialog(): Promise<Result<OpenedProject | null>>
    close(projectId: string): Promise<Result<void>>
    rename(projectId: string, name: string): Promise<Result<ProjectRef>>
    duplicate(projectId: string, name?: string): Promise<Result<ProjectRef>>
    remove(projectId: string, permanent: boolean): Promise<Result<void>>
    forget(projectId: string): Promise<Result<void>>
    importZip(): Promise<Result<OpenedProject | null>>
    exportZip(projectId: string): Promise<Result<string | null>>
    exportPdf(projectId: string): Promise<Result<string | null>>
    getSettings(projectId: string): Promise<Result<ProjectSettings>>
    updateSettings(
      projectId: string,
      patch: DeepPartial<ProjectSettings>
    ): Promise<Result<ProjectSettings>>
    detectRoot(filePath: string): Promise<Result<string>>
  }

  fs: {
    readTree(projectId: string): Promise<Result<FileNode>>
    readFile(projectId: string, path: string): Promise<Result<ReadFilePayload>>
    readBinary(projectId: string, path: string): Promise<Result<ReadBinaryPayload>>
    writeFile(
      projectId: string,
      path: string,
      content: string,
      expectedMtimeMs?: number | null
    ): Promise<Result<WriteFilePayload>>
    createFile(
      projectId: string,
      parentPath: string,
      name: string,
      content?: string
    ): Promise<Result<string>>
    createDirectory(projectId: string, parentPath: string, name: string): Promise<Result<string>>
    rename(projectId: string, path: string, newName: string): Promise<Result<string>>
    move(projectId: string, path: string, targetDirectory: string): Promise<Result<string>>
    remove(projectId: string, path: string): Promise<Result<void>>
    /** Opens a file dialog and copies the chosen files into the project. */
    importFiles(projectId: string, targetDirectory: string): Promise<Result<string[]>>
    /** Copies files that already have an absolute path (OS drag and drop). */
    importExternal(
      projectId: string,
      targetDirectory: string,
      paths: string[]
    ): Promise<Result<string[]>>
    onFileEvent(callback: (events: FileEvent[]) => void): Unsubscribe
  }

  latex: {
    detect(force?: boolean): Promise<Result<LatexEnvironment>>
    build(projectId: string): Promise<Result<BuildResult>>
    cancel(projectId: string): Promise<Result<boolean>>
    readPdf(projectId: string): Promise<Result<PdfPayload>>
    clean(projectId: string): Promise<Result<number>>
    onProgress(callback: (progress: BuildProgress) => void): Unsubscribe
    onResult(callback: (result: BuildResult & { projectId: string }) => void): Unsubscribe
  }

  index: {
    get(projectId: string): Promise<Result<ProjectIndex>>
    refresh(projectId: string): Promise<Result<ProjectIndex>>
    onUpdated(callback: (index: ProjectIndex) => void): Unsubscribe
  }

  search: {
    run(projectId: string, query: SearchQuery): Promise<Result<SearchResults>>
    cancel(): Promise<Result<void>>
  }

  sync: {
    forward(
      projectId: string,
      file: string,
      line: number,
      column: number
    ): Promise<Result<SyncForwardResult>>
    inverse(
      projectId: string,
      page: number,
      x: number,
      y: number
    ): Promise<Result<SyncInverseResult>>
  }

  git: {
    status(projectId: string): Promise<Result<GitStatus>>
    diff(projectId: string, path: string, staged: boolean): Promise<Result<string>>
    stage(projectId: string, paths: string[]): Promise<Result<void>>
    unstage(projectId: string, paths: string[]): Promise<Result<void>>
    commit(projectId: string, message: string): Promise<Result<string>>
    pull(projectId: string): Promise<Result<string>>
    push(projectId: string): Promise<Result<string>>
    init(projectId: string): Promise<Result<void>>
    log(projectId: string, limit?: number): Promise<Result<GitLogEntry[]>>
    onChanged(callback: (payload: { projectId: string }) => void): Unsubscribe
  }

  terminal: {
    run(projectId: string, command: string): Promise<Result<string>>
    kill(sessionId: string): Promise<Result<boolean>>
    onData(callback: (chunk: TerminalChunk) => void): Unsubscribe
    onExit(callback: (exit: TerminalExit) => void): Unsubscribe
  }

  os: {
    defaultAppStatus(): Promise<Result<DefaultAppStatus>>
    setAsDefault(): Promise<Result<{ changed: string[]; failed: string[] }>>
    onOpenFileRequest(callback: (request: OpenFileRequest) => void): Unsubscribe
  }

  menu: {
    onCommand(callback: (command: string) => void): Unsubscribe
  }
}
