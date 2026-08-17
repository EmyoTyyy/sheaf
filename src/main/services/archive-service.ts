import fs from 'node:fs/promises'
import path from 'node:path'
import AdmZip from 'adm-zip'
import type { ProjectSettings } from '@shared/types'
import { fail } from './errors'
import { SHEAF_DIR, isIgnoredDirectory, pathExists, uniquePath } from './paths'
import { resolveBuildPaths } from './latex-compile'

/**
 * Exports the project as a plain ZIP of its sources. Build artefacts, git
 * metadata and Sheaf's own settings are left out so the archive is exactly
 * what another LaTeX tool would expect.
 */
export async function exportProjectZip(root: string, destination: string): Promise<string> {
  const zip = new AdmZip()
  const rootName = path.basename(root)

  const walk = async (relative: string, depth: number): Promise<void> => {
    if (depth > 12) return
    const absolute = relative ? path.join(root, relative) : root
    const entries = await fs.readdir(absolute, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (isIgnoredDirectory(entry.name)) continue
        await walk(childRelative, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      const data = await fs.readFile(path.join(absolute, entry.name)).catch(() => null)
      if (!data) continue
      zip.addFile(`${rootName}/${childRelative}`, data)
    }
  }

  await walk('', 0)

  if (zip.getEntries().length === 0) {
    fail('EXPORT_FAILED', 'Nothing to export', 'The project does not contain any files.')
  }

  await fs.mkdir(path.dirname(destination), { recursive: true })
  await new Promise<void>((resolve, reject) => {
    zip.writeZip(destination, (error) => (error ? reject(error) : resolve()))
  })
  return destination
}

export async function exportPdf(
  root: string,
  settings: ProjectSettings,
  destination: string
): Promise<string> {
  const { outputAbsolute, jobName } = await resolveBuildPaths(root, settings)
  if (!jobName) {
    fail('EXPORT_FAILED', 'No main document', 'Set a main document before exporting the PDF.')
  }
  const source = path.join(outputAbsolute, `${jobName}.pdf`)
  if (!(await pathExists(source))) {
    fail(
      'EXPORT_FAILED',
      'No PDF to export',
      'The project has not been compiled successfully yet.',
      'Compile the document, then export it.'
    )
  }
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.copyFile(source, destination)
  return destination
}

/**
 * Imports a .zip into a new project directory. Entries are checked so a
 * crafted archive cannot write outside the destination.
 */
export async function importProjectZip(
  zipPath: string,
  parentDirectory: string,
  preferredName?: string
): Promise<string> {
  let zip: AdmZip
  try {
    zip = new AdmZip(zipPath)
  } catch (error) {
    fail(
      'IMPORT_FAILED',
      'Could not read the archive',
      `${path.basename(zipPath)} is not a readable ZIP file.`,
      undefined,
      (error as Error).message
    )
  }

  const entries = zip.getEntries().filter((entry) => !entry.isDirectory)
  if (entries.length === 0) {
    fail('IMPORT_FAILED', 'Empty archive', 'The ZIP file does not contain any files.')
  }

  // Strip a single shared top-level folder, which most archives have.
  const topLevels = new Set(entries.map((entry) => entry.entryName.split('/')[0]))
  const commonRoot =
    topLevels.size === 1 && entries.every((entry) => entry.entryName.includes('/'))
      ? [...topLevels][0]
      : null

  const baseName = preferredName?.trim() || commonRoot || path.basename(zipPath, '.zip')
  await fs.mkdir(parentDirectory, { recursive: true })
  const folderName = await uniquePath(parentDirectory, baseName)
  const destination = path.join(parentDirectory, folderName)
  await fs.mkdir(destination)

  const destinationResolved = path.resolve(destination)
  let written = 0

  for (const entry of entries) {
    let entryPath = entry.entryName.replace(/\\/g, '/')
    if (commonRoot) entryPath = entryPath.slice(commonRoot.length + 1)
    if (!entryPath || entryPath.endsWith('/')) continue

    const target = path.resolve(destinationResolved, entryPath)
    if (target !== destinationResolved && !target.startsWith(destinationResolved + path.sep)) {
      // Zip-slip attempt: skip rather than abort, and keep the rest.
      continue
    }
    if (entryPath.split('/').includes(SHEAF_DIR)) continue

    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, entry.getData())
    written += 1
  }

  if (written === 0) {
    await fs.rm(destination, { recursive: true, force: true })
    fail(
      'IMPORT_FAILED',
      'Nothing could be imported',
      'Every entry in the archive was rejected as unsafe or empty.'
    )
  }

  return destination
}
