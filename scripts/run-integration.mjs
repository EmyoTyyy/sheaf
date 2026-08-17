/**
 * Builds and runs the integration tests, which drive a real LaTeX
 * installation. Kept separate from `npm test` so the unit suite stays green on
 * machines without TeX.
 */
import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outFile = join(root, 'out', 'tests', 'integration.cjs')

await mkdir(dirname(outFile), { recursive: true })

await build({
  entryPoints: [join(root, 'tests', 'integration.test.ts')],
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
  },
  define: {
    // The bundle lives in out/tests, but the example project is resolved
    // relative to the repository root.
    __dirname: JSON.stringify(join(root, 'tests'))
  }
})

const child = spawn(process.execPath, [outFile], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 1))
