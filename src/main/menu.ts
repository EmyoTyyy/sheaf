import { Menu, app, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { EVENTS } from '@shared/ipc'

/**
 * Menu items that do not map to an Electron role send a command string to the
 * renderer, which owns the actual behaviour and its keyboard shortcuts.
 */
function command(
  label: string,
  id: string,
  accelerator?: string
): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    click: (_item, window) => {
      const target = window as BrowserWindow | undefined
      target?.webContents.send(EVENTS.menuCommand, id)
    }
  }
}

export function buildApplicationMenu(): Menu {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              command('Settings...', 'settings', 'Cmd+,'),
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        command('New Project...', 'new-project', 'CmdOrCtrl+Shift+N'),
        command('New File...', 'new-file', 'CmdOrCtrl+N'),
        command('Open Project...', 'open-project', 'CmdOrCtrl+O'),
        command('Import from ZIP...', 'import-zip'),
        { type: 'separator' },
        command('Save', 'save', 'CmdOrCtrl+S'),
        command('Save All', 'save-all', 'CmdOrCtrl+Alt+S'),
        { type: 'separator' },
        command('Export PDF...', 'export-pdf'),
        command('Export Project as ZIP...', 'export-zip'),
        { type: 'separator' },
        command('Close Project', 'close-project'),
        ...(isMac ? [] : ([{ type: 'separator' }, { role: 'quit' }] as MenuItemConstructorOptions[]))
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        command('Find', 'find', 'CmdOrCtrl+F'),
        command('Replace', 'replace', 'CmdOrCtrl+H'),
        command('Find in Project', 'find-in-project', 'CmdOrCtrl+Shift+F'),
        command('Quick Open', 'quick-open', 'CmdOrCtrl+P')
      ]
    },
    {
      label: 'View',
      submenu: [
        command('Toggle Explorer', 'toggle-sidebar', 'CmdOrCtrl+B'),
        command('Toggle Bottom Panel', 'toggle-bottom-panel', 'CmdOrCtrl+J'),
        command('Toggle PDF Preview', 'toggle-pdf', 'CmdOrCtrl+Shift+P'),
        command('Distraction-Free Mode', 'distraction-free', 'CmdOrCtrl+Shift+D'),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : ([{ role: 'toggleDevTools' }] as MenuItemConstructorOptions[]))
      ]
    },
    {
      label: 'Build',
      submenu: [
        command('Compile', 'compile', 'CmdOrCtrl+Return'),
        command('Stop Compilation', 'stop-compile'),
        command('Toggle Auto Compile', 'toggle-auto-compile'),
        { type: 'separator' },
        command('Clean Build Files', 'clean'),
        command('Forward Search (source to PDF)', 'sync-forward', 'CmdOrCtrl+Alt+J')
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? ([{ type: 'separator' }, { role: 'front' }] as MenuItemConstructorOptions[])
          : ([{ role: 'close' }] as MenuItemConstructorOptions[]))
      ]
    },
    {
      role: 'help',
      submenu: [
        command('Keyboard Shortcuts', 'shortcuts'),
        command('LaTeX Installation Status', 'latex-status'),
        ...(isMac ? [] : ([command('Settings...', 'settings', 'CmdOrCtrl+,')] as MenuItemConstructorOptions[])),
        { type: 'separator' },
        {
          label: 'CTAN Package Search (opens a browser)',
          click: () => {
            shell.openExternal('https://ctan.org/pkg')
          }
        }
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}
