/**
 * Bundles the test entry point with esbuild (aliasing Electron to a stub) and
 * runs it in Node. Keeping this out of the application build means the tests
 * exercise the real service modules, not a copy of them.
 */
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outFile = join(root, 'out', 'tests', 'core.cjs')

await mkdir(dirname(outFile), { recursive: true })

await build({
  entryPoints: [join(root, 'tests', 'core.test.ts')],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: 'inline',
  logLevel: 'warning',
  alias: {
    electron: join(root, 'tests', 'electron-stub.mjs'),
    '@shared': join(root, 'src', 'shared')
  }
})

const child = spawn(process.execPath, [outFile], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 1))
