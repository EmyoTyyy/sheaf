import path from 'node:path'
import type { ProjectSettings, SyncForwardResult, SyncInverseResult } from '@shared/types'
import { fail } from './errors'
import { getTool } from './latex-detect'
import { run } from './process-runner'
import { pathExists, relativeToProject, toPosix } from './paths'
import { resolveBuildPaths } from './latex-compile'

const TIMEOUT_MS = 10_000

async function requireSynctex(): Promise<string> {
  const tool = await getTool('synctex')
  if (!tool) {
    fail(
      'SYNCTEX_UNAVAILABLE',
      'SyncTeX is not available',
      'The synctex program was not found in your LaTeX installation.',
      'Install it with your TeX distribution to jump between the source and the PDF.'
    )
  }
  return tool.path
}

async function requireSyncFile(outputAbsolute: string, jobName: string): Promise<void> {
  const gz = path.join(outputAbsolute, `${jobName}.synctex.gz`)
  const plain = path.join(outputAbsolute, `${jobName}.synctex`)
  if ((await pathExists(gz)) || (await pathExists(plain))) return
  fail(
    'SYNCTEX_UNAVAILABLE',
    'No SyncTeX data',
    'The document has not been compiled with SyncTeX information yet.',
    'Compile the project once; Sheaf passes -synctex=1 automatically.'
  )
}

function parseRecords(output: string): Record<string, string>[] {
  const records: Record<string, string>[] = []
  let current: Record<string, string> | null = null

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === 'SyncTeX result begin') {
      current = {}
      continue
    }
    if (trimmed === 'SyncTeX result end') {
      if (current && Object.keys(current).length > 0) records.push(current)
      current = null
      continue
    }
    if (!current) continue
    const separator = trimmed.indexOf(':')
    if (separator === -1) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    if (key === 'Output' && current.Page !== undefined) {
      records.push(current)
      current = {}
    }
    current[key] = value
  }

  if (current && Object.keys(current).length > 0) records.push(current)
  return records
}

/**
 * Source position -> location in the PDF. Coordinates come back in PDF points
 * measured from the top-left corner of the page.
 */
export async function forwardSearch(
  root: string,
  settings: ProjectSettings,
  file: string,
  line: number,
  column: number
): Promise<SyncForwardResult> {
  const executable = await requireSynctex()
  const { outputAbsolute, jobName } = await resolveBuildPaths(root, settings)
  if (!jobName) {
    fail('NO_MAIN_DOCUMENT', 'No main document', 'Set a main document before using SyncTeX.')
  }
  await requireSyncFile(outputAbsolute, jobName)

  const pdfPath = path.join(outputAbsolute, `${jobName}.pdf`)
  const attempts = [toPosix(file), path.join(root, file)]

  for (const input of attempts) {
    const result = await run(
      executable,
      ['view', '-i', `${Math.max(1, line)}:${Math.max(1, column)}:${input}`, '-o', pdfPath],
      { cwd: root, timeoutMs: TIMEOUT_MS }
    )
    if (result.spawnError) break

    const records = parseRecords(result.stdout).filter((record) => record.Page !== undefined)
    if (records.length === 0) continue

    const record = records[0]
    const x = Number.parseFloat(record.x ?? record.h ?? '0')
    const y = Number.parseFloat(record.y ?? record.v ?? '0')
    const width = Number.parseFloat(record.W ?? '0')
    const height = Number.parseFloat(record.H ?? '0')

    return {
      page: Number.parseInt(record.Page, 10),
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
      width: Number.isFinite(width) ? Math.abs(width) : 0,
      height: Number.isFinite(height) ? Math.abs(height) : 0
    }
  }

  fail(
    'SYNCTEX_NO_MATCH',
    'No matching place in the PDF',
    'SyncTeX could not map this line to a position in the document.',
    'This happens for lines that produce no output, such as comments or preamble code.'
  )
}

/** A point in the PDF -> the source line that produced it. */
export async function inverseSearch(
  root: string,
  settings: ProjectSettings,
  page: number,
  x: number,
  y: number
): Promise<SyncInverseResult> {
  const executable = await requireSynctex()
  const { outputAbsolute, jobName } = await resolveBuildPaths(root, settings)
  if (!jobName) {
    fail('NO_MAIN_DOCUMENT', 'No main document', 'Set a main document before using SyncTeX.')
  }
  await requireSyncFile(outputAbsolute, jobName)

  const pdfPath = path.join(outputAbsolute, `${jobName}.pdf`)
  const result = await run(
    executable,
    ['edit', '-o', `${page}:${x.toFixed(2)}:${y.toFixed(2)}:${pdfPath}`],
    { cwd: root, timeoutMs: TIMEOUT_MS }
  )

  if (result.spawnError) {
    fail('SYNCTEX_UNAVAILABLE', 'SyncTeX failed to run', result.spawnError.message)
  }

  const records = parseRecords(result.stdout).filter((record) => record.Input !== undefined)
  if (records.length === 0) {
    fail(
      'SYNCTEX_NO_MATCH',
      'No matching source line',
      'SyncTeX could not map this point to a line in the source.',
      'Click directly on a piece of text rather than on empty space.'
    )
  }

  const record = records[0]
  const inputPath = record.Input
  const absolute = path.isAbsolute(inputPath) ? inputPath : path.resolve(root, inputPath)
  const relative = relativeToProject(root, absolute)

  if (!relative) {
    fail(
      'SYNCTEX_NO_MATCH',
      'Source is outside the project',
      `That part of the document comes from ${inputPath}, which is not a project file.`
    )
  }

  const column = Number.parseInt(record.Column ?? '-1', 10)
  return {
    file: relative,
    line: Math.max(1, Number.parseInt(record.Line ?? '1', 10)),
    column: Number.isFinite(column) && column > 0 ? column : 1
  }
}
