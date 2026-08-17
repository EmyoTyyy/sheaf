import fs from 'node:fs/promises'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import type {
  BuildPass,
  BuildProgress,
  BuildResult,
  Diagnostic,
  ProjectSettings
} from '@shared/types'
import { SheafError, fail } from './errors'
import { detectLatex } from './latex-detect'
import { isFatal, needsRerun, parseBibLog, parseLatexLog, type ParseContext } from './log-parser'
import {
  AUX_EXTENSIONS,
  DEFAULT_OUTPUT_DIR,
  isIgnoredDirectory,
  pathExists,
  resolveInProject
} from './paths'
import { killTree, run } from './process-runner'
import { detectMainDocument } from './project-service'

export interface BuildRequest {
  projectId: string
  root: string
  settings: ProjectSettings
  onProgress: (progress: BuildProgress) => void
}

interface RunningBuild {
  buildId: string
  child: ChildProcess | null
  cancelled: boolean
}

const running = new Map<string, RunningBuild>()
let buildCounter = 0

export function isBuilding(projectId: string): boolean {
  return running.has(projectId)
}

export function cancelBuild(projectId: string): boolean {
  const current = running.get(projectId)
  if (!current) return false
  current.cancelled = true
  if (current.child) killTree(current.child)
  return true
}

/* ------------------------------------------------------------------ */
/* Command construction                                                */
/* ------------------------------------------------------------------ */

interface EngineInvocation {
  executable: string
  args: string[]
  label: string
}

/**
 * The output directory is passed relative to the project root. TeX's paranoid
 * write policy refuses absolute output paths, and a relative one keeps every
 * artefact provably inside the project.
 */
function engineCommand(
  settings: ProjectSettings,
  toolPath: string,
  mainRelative: string,
  outputDirRelative: string
): EngineInvocation {
  const compiler = settings.compiler
  const outFlagValue = outputDirRelative || '.'

  if (compiler === 'latexmk') {
    return {
      executable: toolPath,
      label: 'latexmk',
      args: [
        '-pdf',
        '-synctex=1',
        '-interaction=nonstopmode',
        '-file-line-error',
        `-outdir=${outFlagValue}`,
        ...settings.extraArgs,
        mainRelative
      ]
    }
  }

  if (compiler === 'tectonic') {
    return {
      executable: toolPath,
      label: 'tectonic',
      args: [
        '--synctex',
        '--keep-logs',
        '--outdir',
        outFlagValue,
        ...settings.extraArgs,
        mainRelative
      ]
    }
  }

  return {
    executable: toolPath,
    label: compiler,
    args: [
      '-synctex=1',
      '-interaction=nonstopmode',
      '-file-line-error',
      '-recorder',
      `-output-directory=${outFlagValue}`,
      ...settings.extraArgs,
      mainRelative
    ]
  }
}

/** Displayed to the user so the exact command is never a mystery. */
function describeCommand(invocation: EngineInvocation): string {
  const quote = (value: string): string => (/\s/.test(value) ? JSON.stringify(value) : value)
  return [path.basename(invocation.executable), ...invocation.args].map(quote).join(' ')
}

function buildEnvironment(root: string, outputDirAbsolute: string): NodeJS.ProcessEnv {
  const sep = process.platform === 'win32' ? ';' : ':'
  // Long lines keep file names intact in the log, which the parser relies on.
  return {
    ...process.env,
    max_print_line: '10000',
    error_line: '254',
    half_error_line: '238',
    // '//' means "and all subdirectories"; the trailing separator appends the
    // distribution's own defaults rather than replacing them.
    TEXINPUTS: `.${sep}${root}${sep}${root}//${sep}${process.env.TEXINPUTS ?? ''}`,
    BIBINPUTS: `.${sep}${root}${sep}${root}//${sep}${process.env.BIBINPUTS ?? ''}`,
    BSTINPUTS: `.${sep}${root}${sep}${root}//${sep}${process.env.BSTINPUTS ?? ''}`,
    TEXMFOUTPUT: outputDirAbsolute
  }
}

/* ------------------------------------------------------------------ */
/* Output directory                                                    */
/* ------------------------------------------------------------------ */

/**
 * \include writes its .aux next to the included file, mirrored into the output
 * directory. TeX will not create those subdirectories itself, so we do.
 */
async function mirrorDirectories(root: string, outputAbsolute: string): Promise<void> {
  await fs.mkdir(outputAbsolute, { recursive: true })
  const walk = async (relative: string, depth: number): Promise<void> => {
    if (depth > 8) return
    const absolute = relative ? path.join(root, relative) : root
    const entries = await fs.readdir(absolute, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || isIgnoredDirectory(entry.name)) continue
      const childRelative = relative ? path.join(relative, entry.name) : entry.name
      await fs.mkdir(path.join(outputAbsolute, childRelative), { recursive: true })
      await walk(childRelative, depth + 1)
    }
  }
  await walk('', 0)
}

/* ------------------------------------------------------------------ */
/* Bibliography pass                                                   */
/* ------------------------------------------------------------------ */

type BibChoice = { tool: 'biber' | 'bibtex'; executable: string } | null

async function chooseBibTool(
  settings: ProjectSettings,
  outputAbsolute: string,
  jobName: string
): Promise<BibChoice> {
  if (settings.bibTool === 'none') return null
  const environment = await detectLatex()

  const bcf = path.join(outputAbsolute, `${jobName}.bcf`)
  const aux = path.join(outputAbsolute, `${jobName}.aux`)

  const wantsBiber = await pathExists(bcf)
  if (wantsBiber && settings.bibTool !== 'bibtex') {
    const biber = environment.tools.biber
    if (biber) return { tool: 'biber', executable: biber.path }
  }

  if (settings.bibTool === 'biber') {
    const biber = environment.tools.biber
    return biber ? { tool: 'biber', executable: biber.path } : null
  }

  const auxContent = await fs.readFile(aux, 'utf8').catch(() => '')
  const hasCitations = /\\citation\{/.test(auxContent) || /\\bibdata\{/.test(auxContent)
  if (!hasCitations) return null

  const bibtex = environment.tools.bibtex
  return bibtex ? { tool: 'bibtex', executable: bibtex.path } : null
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

export async function build(request: BuildRequest): Promise<BuildResult> {
  const { projectId, root, settings, onProgress } = request

  if (running.has(projectId)) {
    cancelBuild(projectId)
  }

  buildCounter += 1
  const buildId = `b${buildCounter}-${Date.now()}`
  const state: RunningBuild = { buildId, child: null, cancelled: false }
  running.set(projectId, state)

  const startedAt = Date.now()
  const passes: BuildPass[] = []
  let log = ''

  const emit = (phase: string, chunk?: string): void => {
    onProgress({ buildId, projectId, phase, chunk })
  }

  try {
    const environment = await detectLatex()
    if (!environment.detected) {
      fail(
        'NO_LATEX',
        'LaTeX compiler not found',
        'No TeX Live, MiKTeX or Tectonic installation could be detected on this computer.',
        'Install a LaTeX distribution, then set the path to its bin directory in Settings > LaTeX. On Debian and Ubuntu: sudo apt install texlive-latex-recommended texlive-latex-extra.'
      )
    }

    const toolKey = settings.compiler
    const tool = environment.tools[toolKey]
    if (!tool) {
      const available = Object.keys(environment.tools)
        .filter((name) => ['pdflatex', 'xelatex', 'lualatex', 'latexmk', 'tectonic'].includes(name))
        .join(', ')
      fail(
        'COMPILER_MISSING',
        `${toolKey} is not available`,
        `The project is set to compile with ${toolKey}, which was not found${
          environment.distribution ? ` in ${environment.distribution}` : ''
        }.`,
        available
          ? `Switch the compiler in the project settings. Available here: ${available}.`
          : 'Install a LaTeX distribution or set its bin directory in Settings > LaTeX.'
      )
    }

    const mainRelative = await detectMainDocument(root, settings.mainDocument)
    if (!mainRelative) {
      fail(
        'NO_MAIN_DOCUMENT',
        'No main document',
        'No .tex file containing \\documentclass was found in this project.',
        'Create one, or right-click a .tex file in the explorer and choose "Set as main document".'
      )
    }

    const outputDirRelative = (settings.outputDirectory || DEFAULT_OUTPUT_DIR).replace(/\\/g, '/')
    const outputAbsolute = outputDirRelative
      ? resolveInProject(root, outputDirRelative)
      : path.resolve(root)
    await mirrorDirectories(root, outputAbsolute)

    const jobName = path.basename(mainRelative, path.extname(mainRelative))
    const env = buildEnvironment(root, outputAbsolute)
    const timeoutMs = Math.max(5000, settings.compileTimeoutMs)
    const parseContext: ParseContext = { root, cwd: root, mainFile: mainRelative }

    const runEngine = async (label: string): Promise<void> => {
      const invocation = engineCommand(settings, tool.path, mainRelative, outputDirRelative)
      emit(label)
      const result = await run(invocation.executable, invocation.args, {
        cwd: root,
        env,
        timeoutMs,
        onStart: (child) => {
          state.child = child
        },
        onChunk: (chunk) => emit(label, chunk)
      })
      state.child = null

      if (result.spawnError) {
        fail(
          'COMPILER_MISSING',
          `Could not start ${settings.compiler}`,
          `${invocation.executable} could not be executed.`,
          'Check the compiler path in Settings > LaTeX.',
          result.spawnError.message
        )
      }
      if (result.timedOut) {
        fail(
          'COMPILE_TIMEOUT',
          'Compilation timed out',
          `${settings.compiler} was still running after ${Math.round(timeoutMs / 1000)} seconds and was stopped.`,
          'Increase the timeout in the project settings, or look for an infinite loop in the document.'
        )
      }

      log += `\n$ ${describeCommand(invocation)}\n${result.stdout}${result.stderr}`
      passes.push({
        label: invocation.label,
        command: describeCommand(invocation),
        exitCode: result.exitCode,
        durationMs: result.durationMs
      })
    }

    // Pass 1
    await runEngine(`Running ${settings.compiler}`)
    if (state.cancelled) return cancelledResult(buildId, startedAt, passes, log)

    // latexmk and tectonic already resolve bibliographies and reruns.
    const manages = settings.compiler === 'latexmk' || settings.compiler === 'tectonic'

    if (!manages) {
      const bib = await chooseBibTool(settings, outputAbsolute, jobName)
      if (bib) {
        emit(`Running ${bib.tool}`)
        const bibResult = await run(bib.executable, [jobName], {
          cwd: outputAbsolute,
          env,
          timeoutMs,
          onStart: (child) => {
            state.child = child
          },
          onChunk: (chunk) => emit(`Running ${bib.tool}`, chunk)
        })
        state.child = null
        if (!bibResult.spawnError) {
          log += `\n$ ${path.basename(bib.executable)} ${jobName}\n${bibResult.stdout}${bibResult.stderr}`
          passes.push({
            label: bib.tool,
            command: `${path.basename(bib.executable)} ${jobName}`,
            exitCode: bibResult.exitCode,
            durationMs: bibResult.durationMs
          })
          // Bibliography output needs at least one more engine pass.
          await runEngine(`Running ${settings.compiler} (bibliography)`)
        }
      }

      let pass = passes.filter((entry) => entry.label === settings.compiler).length
      while (pass < settings.maxPasses && needsRerun(log) && !state.cancelled) {
        await runEngine(`Running ${settings.compiler} (pass ${pass + 1})`)
        pass += 1
      }
    }

    if (state.cancelled) return cancelledResult(buildId, startedAt, passes, log)

    emit('Reading log')
    const logFile = path.join(outputAbsolute, `${jobName}.log`)
    const logFileContent = await fs.readFile(logFile, 'utf8').catch(() => '')
    const fullLog = logFileContent ? `${log}\n\n--- ${jobName}.log ---\n${logFileContent}` : log

    const diagnostics: Diagnostic[] = parseLatexLog(logFileContent || log, parseContext)
    const blgFile = path.join(outputAbsolute, `${jobName}.blg`)
    const blgContent = await fs.readFile(blgFile, 'utf8').catch(() => '')
    if (blgContent) {
      diagnostics.push(...parseBibLog(blgContent, parseContext))
    }

    const pdfPath = path.join(outputAbsolute, `${jobName}.pdf`)
    const pdfStat = await fs.stat(pdfPath).catch(() => null)
    const lastExit = passes[passes.length - 1]?.exitCode ?? 1
    const hasErrors = diagnostics.some((entry) => entry.severity === 'error')
    const fatal = isFatal(logFileContent || log)

    const produced = pdfStat != null && pdfStat.mtimeMs >= startedAt - 2000
    const status: BuildResult['status'] =
      !fatal && produced && (lastExit === 0 || !hasErrors) ? 'success' : 'error'

    let error: BuildResult['error']
    if (status === 'error' && !pdfStat) {
      error = {
        code: 'NO_PDF_PRODUCED',
        title: 'No PDF was produced',
        detail: hasErrors
          ? 'The document contains errors that stopped the engine before it could write a PDF.'
          : `${settings.compiler} exited with code ${lastExit} without writing a PDF.`,
        action: hasErrors
          ? 'Fix the first error in the Problems panel; later errors are often caused by it.'
          : 'Open the Raw Log tab for the full compiler output.'
      }
    }

    return {
      id: buildId,
      status,
      diagnostics,
      log: fullLog.trim(),
      pdfPath: pdfStat ? pdfPath : null,
      pdfMtimeMs: pdfStat?.mtimeMs ?? null,
      durationMs: Date.now() - startedAt,
      passes,
      error
    }
  } catch (error) {
    if (state.cancelled) return cancelledResult(buildId, startedAt, passes, log)
    if (error instanceof SheafError) {
      return {
        id: buildId,
        status: error.code === 'COMPILE_TIMEOUT' ? 'timeout' : 'error',
        diagnostics: [],
        log: log.trim(),
        pdfPath: null,
        pdfMtimeMs: null,
        durationMs: Date.now() - startedAt,
        passes,
        error: error.toAppError()
      }
    }
    throw error
  } finally {
    // A newer build may already have replaced this entry; only clear our own.
    if (running.get(projectId) === state) running.delete(projectId)
  }
}

function cancelledResult(
  buildId: string,
  startedAt: number,
  passes: BuildPass[],
  log: string
): BuildResult {
  return {
    id: buildId,
    status: 'cancelled',
    diagnostics: [],
    log: log.trim(),
    pdfPath: null,
    pdfMtimeMs: null,
    durationMs: Date.now() - startedAt,
    passes,
    error: {
      code: 'CANCELLED',
      title: 'Compilation cancelled',
      detail: 'The build was stopped before it finished.'
    }
  }
}

/** Reads the PDF produced by the last successful build. */
export async function readPdf(
  root: string,
  settings: ProjectSettings
): Promise<{ data: Uint8Array; mtimeMs: number; path: string }> {
  const mainRelative = await detectMainDocument(root, settings.mainDocument)
  if (!mainRelative) {
    fail('NO_MAIN_DOCUMENT', 'No main document', 'This project has no root .tex file yet.')
  }
  const outputDirRelative = settings.outputDirectory || DEFAULT_OUTPUT_DIR
  const outputAbsolute = outputDirRelative ? resolveInProject(root, outputDirRelative) : root
  const jobName = path.basename(mainRelative, path.extname(mainRelative))
  const pdfPath = path.join(outputAbsolute, `${jobName}.pdf`)
  const stat = await fs.stat(pdfPath).catch(() => null)
  if (!stat) {
    fail(
      'NO_PDF_PRODUCED',
      'No PDF yet',
      'This project has not been compiled successfully yet.',
      'Press Compile to build the document.'
    )
  }
  const data = await fs.readFile(pdfPath)
  return { data: new Uint8Array(data), mtimeMs: stat.mtimeMs, path: pdfPath }
}

/** Resolves the absolute paths used by a build without running one. */
export async function resolveBuildPaths(
  root: string,
  settings: ProjectSettings
): Promise<{ mainRelative: string | null; outputAbsolute: string; jobName: string | null }> {
  const mainRelative = await detectMainDocument(root, settings.mainDocument)
  const outputDirRelative = settings.outputDirectory || DEFAULT_OUTPUT_DIR
  const outputAbsolute = outputDirRelative ? resolveInProject(root, outputDirRelative) : root
  return {
    mainRelative,
    outputAbsolute,
    jobName: mainRelative ? path.basename(mainRelative, path.extname(mainRelative)) : null
  }
}

/** Deletes build artefacts but never touches sources. */
export async function cleanBuild(root: string, settings: ProjectSettings): Promise<number> {
  const { outputAbsolute } = await resolveBuildPaths(root, settings)
  if (path.resolve(outputAbsolute) === path.resolve(root)) {
    // Artefacts live next to the sources: remove them individually.
    let removed = 0
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!AUX_EXTENSIONS.has(ext)) continue
      await fs.rm(path.join(root, entry.name), { force: true })
      removed += 1
    }
    return removed
  }
  const exists = await pathExists(outputAbsolute)
  if (!exists) return 0
  await fs.rm(outputAbsolute, { recursive: true, force: true })
  await fs.mkdir(outputAbsolute, { recursive: true })
  return 1
}
