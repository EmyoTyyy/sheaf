/**
 * Copies the pdf.js character maps and standard fonts into the renderer's
 * public directory. They are needed to display documents that use CJK
 * encodings or rely on the base PDF fonts, and bundling them keeps the viewer
 * working with no network access.
 */
import { cp, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const source = join(root, 'node_modules', 'pdfjs-dist')
const destination = join(root, 'src', 'renderer', 'public', 'pdfjs')

const ASSETS = ['cmaps', 'standard_fonts']

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function main() {
  if (!(await exists(source))) {
    console.error('[sheaf] pdfjs-dist is not installed; run npm install first.')
    process.exit(1)
  }

  await mkdir(destination, { recursive: true })
  for (const asset of ASSETS) {
    const from = join(source, asset)
    if (!(await exists(from))) {
      console.warn(`[sheaf] pdfjs asset "${asset}" not found, skipping.`)
      continue
    }
    await cp(from, join(destination, asset), { recursive: true, force: true })
  }
  console.log('[sheaf] pdf.js assets copied to src/renderer/public/pdfjs')
}

await main()
