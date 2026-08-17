/*
 * Captures the screenshots used by the website in docs/.
 *
 * Everything below is produced by driving the real application through the same
 * command channel the menus use, so the pictures on the website can never show
 * something the application does not do.
 *
 *   npm run build
 *   node scripts/site-screenshots.cjs           # both themes into out/site-shots
 *   node scripts/site-screenshots.cjs --theme light
 *
 * The captures are full windows at device scale 2. scripts/site-crops.py cuts
 * them down to the tiles the page uses.
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const ELECTRON = path.join(ROOT, 'node_modules', '.bin', 'electron')
const EXAMPLE = path.join(ROOT, 'examples', 'demo-thesis')

/* ------------------------------------------------------------ the driver -- */

if (process.env.SHEAF_SHOT_CHILD) {
  require(path.join(ROOT, 'out', 'main', 'index.js'))
  const { app, BrowserWindow } = require('electron')

  const OUT = process.env.SHEAF_SHOT_DIR
  const THEME = process.env.SHEAF_SHOT_THEME
  const PROJECT = process.env.SHEAF_SHOT_PROJECT
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const command = (w, id) => w.webContents.send('event:menu-command', id)

  const capture = async (w, name) => {
    const image = await w.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, `${name}.png`), image.toPNG())
    console.log('  captured', name)
  }

  // Page offsets only settle once the neighbouring pages have rendered.
  const showPage = async (w, index) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await w.webContents.executeJavaScript(`
        (() => {
          const scroll = document.querySelector('.pdf-scroll')
          const page = document.querySelectorAll('.pdf-page')[${index}]
          if (scroll && page) scroll.scrollTop = page.offsetTop - 14
        })()
      `)
      await wait(1800)
    }
  }

  const type = (w, selector, value, enter = false) =>
    w.webContents.executeJavaScript(`
      (() => {
        const input = document.querySelector(${JSON.stringify(selector)})
        if (!input) return 'missing'
        const proto = window.HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, ${JSON.stringify(value)})
        input.dispatchEvent(new Event('input', { bubbles: true }))
        ${enter ? "input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))" : ''}
        return 'ok'
      })()
    `)

  app.whenReady().then(async () => {
    await wait(4500)
    const w = BrowserWindow.getAllWindows()[0]
    if (!w) {
      console.error('no window appeared')
      app.exit(1)
      return
    }
    w.setSize(1440, 900)
    await wait(400)
    await w.webContents.executeJavaScript(
      `window.sheaf.settings.update({ app: { theme: ${JSON.stringify(THEME)} } })`
    )
    await wait(1500)

    command(w, 'compile')
    await wait(16000)
    // A second build with a document already open: this used to blank the
    // window, so it is worth exercising on every capture run.
    command(w, 'compile')
    await wait(16000)
    const pages = await w.webContents.executeJavaScript(
      `document.querySelectorAll('.pdf-page').length`
    )
    if (pages === 0) {
      console.error('the viewer is empty after two builds')
      app.exit(1)
      return
    }

    // A real failure: the file is edited on disk, so the build breaks for the
    // same reason a typo would.
    const broken = path.join(PROJECT, 'chapters', 'results.tex')
    const original = fs.readFileSync(broken, 'utf8')
    fs.writeFileSync(
      broken,
      original.replace('\\section{Displayed mathematics}', '\\sectoin{Displayed mathematics}')
    )
    await wait(2500)
    command(w, 'compile')
    await wait(14000)
    await capture(w, 'error')
    fs.writeFileSync(broken, original)
    await wait(2000)

    command(w, 'compile')
    await wait(14000)
    await showPage(w, 4)
    await capture(w, 'problems')

    command(w, 'toggle-bottom-panel')
    await wait(1500)
    await capture(w, 'workbench')

    command(w, 'find-in-project')
    await wait(900)
    await type(w, '.search-panel input', 'convergence', true)
    await wait(2500)
    await capture(w, 'search')

    command(w, 'latex-status')
    await wait(2500)
    await capture(w, 'latex-status')

    // Dismissed through the backdrop the dialog listens on: a synthetic Escape
    // does not always reach it, and a dialog left open swallows what follows.
    await w.webContents.executeJavaScript(`
      (() => {
        const backdrop = document.querySelector('.modal-backdrop')
        if (backdrop) backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      })()
    `)
    await wait(1000)

    command(w, 'toggle-bottom-panel')
    await wait(1200)
    const onRawLog = await w.webContents.executeJavaScript(`
      (() => {
        const tab = [...document.querySelectorAll('.bottom-panel__tab')]
          .find((node) => node.textContent.trim().startsWith('Raw Log'))
        if (!tab) return false
        tab.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        return true
      })()
    `)
    await wait(1500)
    const rawLogActive = await w.webContents.executeJavaScript(`
      !!document.querySelector('.bottom-panel__tab--active')?.textContent.trim().startsWith('Raw Log')
    `)
    if (!onRawLog || !rawLogActive) {
      console.error('the raw log tab did not open')
      app.exit(1)
      return
    }
    await capture(w, 'raw-log')

    await wait(500)
    app.quit()
  })

  return
}

/* ------------------------------------------------------------ the runner -- */

const only = process.argv.includes('--theme')
  ? [process.argv[process.argv.indexOf('--theme') + 1]]
  : ['dark', 'light']

if (!fs.existsSync(path.join(ROOT, 'out', 'main', 'index.js'))) {
  console.error('Run "npm run build" first.')
  process.exit(1)
}

for (const theme of only) {
  const out = path.join(ROOT, 'out', 'site-shots', theme)
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })

  // The example project is copied, because the run deliberately breaks a file
  // and compiles into .sheaf/build.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sheaf-site-'))
  const project = path.join(work, 'demo-thesis')
  fs.cpSync(EXAMPLE, project, { recursive: true })
  fs.rmSync(path.join(project, '.sheaf'), { recursive: true, force: true })

  console.log(`capturing ${theme} from ${project}`)
  const result = spawnSync(
    ELECTRON,
    [
      __filename,
      '--force-device-scale-factor=2',
      `--user-data-dir=${path.join(work, 'userdata')}`,
      path.join(project, 'chapters', 'methodology.tex')
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        // Editors that host a Node runtime set this, and it stops Electron
        // from starting as Electron at all.
        ELECTRON_RUN_AS_NODE: undefined,
        SHEAF_SHOT_CHILD: '1',
        SHEAF_SHOT_DIR: out,
        SHEAF_SHOT_THEME: theme,
        SHEAF_SHOT_PROJECT: project
      }
    }
  )

  fs.rmSync(work, { recursive: true, force: true })
  if (result.status !== 0) {
    console.error(`capture failed for the ${theme} theme`)
    process.exit(result.status ?? 1)
  }
  console.log(`  written to ${path.relative(ROOT, out)}`)
}
