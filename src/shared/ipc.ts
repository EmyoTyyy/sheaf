/** Channel names shared by the preload bridge and the main process. */

export const IPC = {
  system: {
    info: 'system:info',
    openPath: 'system:open-path',
    showItemInFolder: 'system:show-item-in-folder',
    openExternal: 'system:open-external'
  },
  settings: {
    get: 'settings:get',
    update: 'settings:update',
    reset: 'settings:reset'
  },
  projects: {
    listRecent: 'projects:list-recent',
    templates: 'projects:templates',
    create: 'projects:create',
    open: 'projects:open',
    openDialog: 'projects:open-dialog',
    close: 'projects:close',
    rename: 'projects:rename',
    remove: 'projects:remove',
    forget: 'projects:forget',
    duplicate: 'projects:duplicate',
    importZip: 'projects:import-zip',
    exportZip: 'projects:export-zip',
    exportPdf: 'projects:export-pdf',
    getSettings: 'projects:get-settings',
    updateSettings: 'projects:update-settings',
    detectRoot: 'projects:detect-root'
  },
  fs: {
    readTree: 'fs:read-tree',
    readFile: 'fs:read-file',
    readBinary: 'fs:read-binary',
    writeFile: 'fs:write-file',
    createFile: 'fs:create-file',
    createDirectory: 'fs:create-directory',
    rename: 'fs:rename',
    move: 'fs:move',
    remove: 'fs:remove',
    importFiles: 'fs:import-files',
    importExternal: 'fs:import-external'
  },
  latex: {
    detect: 'latex:detect',
    build: 'latex:build',
    cancel: 'latex:cancel',
    readPdf: 'latex:read-pdf',
    clean: 'latex:clean'
  },
  index: {
    get: 'index:get',
    refresh: 'index:refresh'
  },
  search: {
    run: 'search:run',
    cancel: 'search:cancel'
  },
  sync: {
    forward: 'sync:forward',
    inverse: 'sync:inverse'
  },
  git: {
    status: 'git:status',
    diff: 'git:diff',
    stage: 'git:stage',
    unstage: 'git:unstage',
    commit: 'git:commit',
    pull: 'git:pull',
    push: 'git:push',
    init: 'git:init',
    log: 'git:log'
  },
  terminal: {
    run: 'terminal:run',
    kill: 'terminal:kill',
    cwdListing: 'terminal:cwd-listing'
  },
  os: {
    defaultAppStatus: 'os:default-app-status',
    setAsDefault: 'os:set-as-default'
  }
} as const

/** main -> renderer push channels. */
export const EVENTS = {
  fileEvent: 'event:file',
  buildProgress: 'event:build-progress',
  buildResult: 'event:build-result',
  indexUpdated: 'event:index-updated',
  settingsChanged: 'event:settings-changed',
  openFileRequest: 'event:open-file-request',
  terminalData: 'event:terminal-data',
  terminalExit: 'event:terminal-exit',
  gitChanged: 'event:git-changed',
  menuCommand: 'event:menu-command'
} as const
