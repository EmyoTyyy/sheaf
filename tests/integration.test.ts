/* eslint-disable no-console */
/**
 * Integration tests against a real LaTeX installation.
 *
 * These are kept out of `npm test` because they need TeX Live or MiKTeX on the
 * machine. Run them with `npm run test:latex`. Everything here goes through the
 * same service modules the application uses, on the example project in
 * examples/demo-thesis.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { detectLatex } from '../src/main/services/latex-detect'
import { build, cleanBuild, readPdf } from '../src/main/services/latex-compile'
import { forwardSearch, inverseSearch } from '../src/main/services/synctex-service'
import { detectMainDocument } from '../src/main/services/project-service'
import { buildProjectIndex } from '../src/main/services/index-service'
import { copyDirectory } from '../src/main/services/fs-service'
import type { ProjectSettings } from '../src/shared/types'

process.env.SHEAF_TEST_USERDATA = mkdtempSync(path.join(os.tmpdir(), 'sheaf-int-userdata-'))

const EXAMPLE = path.resolve(__dirname, '..', 'examples', 'demo-thesis')

const SETTINGS: ProjectSettings = {
  mainDocument: null,
  compiler: 'pdflatex',
  extraArgs: [],
  bibTool: 'auto',
  outputDirectory: '.sheaf/build',
  autoCompile: false,
  autoCompileDelayMs: 1500,
  compileTimeoutMs: 120_000,
  maxPasses: 4,
  figureTemplate: ''
}

/* ------------------------------------------------------------------ */

interface Case {
  name: string
  fn: () => void | Promise<void>
}

const cases: Case[] = []
let currentGroup = ''

function group(name: string): void {
  currentGroup = name
}

function test(name: string, fn: () => void | Promise<void>): void {
  cases.push({ name: `${currentGroup} > ${name}`, fn })
}

async function tempCopyOfExample(prefix: string): Promise<string> {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), `sheaf-${prefix}-`))
  const destination = path.join(parent, 'demo-thesis')
  await copyDirectory(EXAMPLE, destination)
  return destination
}

async function runAll(): Promise<void> {
  const environment = await detectLatex(true)
  if (!environment.detected) {
    console.log('No LaTeX installation found; skipping the integration tests.')
    console.log('Install TeX Live or MiKTeX, then run `npm run test:latex` again.')
    return
  }
  console.log(`Using ${environment.distribution ?? 'an unidentified TeX installation'}\n`)

  let passed = 0
  const failures: { name: string; error: unknown }[] = []

  for (const entry of cases) {
    const startedAt = Date.now()
    try {
      await entry.fn()
      passed += 1
      console.log(`  ok   ${entry.name}  (${Date.now() - startedAt} ms)`)
    } catch (error) {
      failures.push({ name: entry.name, error })
      console.log(`  FAIL ${entry.name}`)
    }
  }

  console.log(`\n${passed}/${cases.length} passed`)
  for (const failure of failures) {
    console.log(`\n--- ${failure.name} ---`)
    console.log(failure.error instanceof Error ? failure.error.message : String(failure.error))
  }
  if (failures.length > 0) process.exit(1)
}

/* ------------------------------------------------------------------ */

group('toolchain')

test('finds the engines and helpers that are installed', async () => {
  const environment = await detectLatex(true)
  assert.equal(environment.detected, true)
  assert.ok(environment.tools.pdflatex, 'pdflatex should have been found')
  assert.match(environment.tools.pdflatex.version ?? '', /pdfTeX|MiKTeX/i)
})

/* ------------------------------------------------------------------ */

group('example project')

test('finds main.tex as the root document', async () => {
  assert.equal(await detectMainDocument(EXAMPLE, null), 'main.tex')
})

test('static analysis finds no undefined references or citations', async () => {
  // The index runs against the project on disk, before anything is compiled.
  const index = await buildProjectIndex('integration-index-project').catch(() => null)
  // buildProjectIndex needs an opened project; index the files directly instead.
  void index

  const { parseTex } = await import('../src/main/services/tex-parser')
  const { parseBib } = await import('../src/main/services/bib-parser')

  const labels = new Set<string>()
  const refs: string[] = []
  const citations: string[] = []

  for (const relative of [
    'main.tex',
    'chapters/introduction.tex',
    'chapters/methodology.tex',
    'chapters/results.tex',
    'chapters/conclusion.tex'
  ]) {
    const content = await fs.readFile(path.join(EXAMPLE, relative), 'utf8')
    const parsed = parseTex(content, { path: relative, mtimeMs: 0 })
    for (const label of parsed.labels) labels.add(label.name)
    refs.push(...parsed.refs.map((ref) => ref.key))
    citations.push(...parsed.citations.map((citation) => citation.key))
  }

  const bib = await fs.readFile(path.join(EXAMPLE, 'bibliography.bib'), 'utf8')
  const keys = new Set(parseBib(bib, 'bibliography.bib').entries.map((entry) => entry.key))

  const danglingRefs = refs.filter((ref) => !labels.has(ref))
  assert.deepEqual(danglingRefs, [], 'every \\ref must have a \\label')

  const danglingCitations = citations.filter((citation) => !keys.has(citation))
  assert.deepEqual(danglingCitations, [], 'every \\cite must have a bibliography entry')
})

/* ------------------------------------------------------------------ */

group('real compilation')

test('compiles cleanly, resolving the bibliography and cross-references', async () => {
  const root = await tempCopyOfExample('compile')
  const phases: string[] = []

  const result = await build({
    projectId: 'integration-1',
    root,
    settings: SETTINGS,
    onProgress: (progress) => {
      if (!progress.chunk) phases.push(progress.phase)
    }
  })

  assert.equal(result.status, 'success', result.error?.detail ?? 'build did not succeed')

  const errors = result.diagnostics.filter((entry) => entry.severity === 'error')
  assert.deepEqual(errors, [], 'a clean project must produce no errors')

  const referenceWarnings = result.diagnostics.filter(
    (entry) => entry.severity === 'warning' && /undefined|Citation|Reference/i.test(entry.message)
  )
  assert.deepEqual(
    referenceWarnings.map((entry) => entry.message),
    [],
    'references and citations must resolve after the reruns'
  )

  // bibtex ran, and the engine ran again afterwards.
  assert.ok(
    result.passes.some((pass) => pass.label === 'bibtex' || pass.label === 'biber'),
    `expected a bibliography pass, got: ${result.passes.map((p) => p.label).join(', ')}`
  )
  assert.ok(
    result.passes.filter((pass) => pass.label === 'pdflatex').length >= 2,
    'expected at least two engine passes so cross-references settle'
  )
  assert.ok(phases.length >= 3, 'expected progress updates for each pass')

  await fs.access(path.join(root, '.sheaf', 'build', 'main.bbl'))
  await fs.access(path.join(root, '.sheaf', 'build', 'main.pdf'))
})

test('produces a multi-page PDF the viewer can read', async () => {
  const root = await tempCopyOfExample('pdf')
  const result = await build({
    projectId: 'integration-2',
    root,
    settings: SETTINGS,
    onProgress: () => undefined
  })
  assert.equal(result.status, 'success', result.error?.detail)

  const payload = await readPdf(root, SETTINGS)
  const header = Buffer.from(payload.data.subarray(0, 5)).toString('latin1')
  assert.equal(header, '%PDF-', 'the file must start with a PDF header')
  assert.ok(payload.data.length > 20_000, 'a document with a figure should not be tiny')

  // pdfTeX compresses the page tree, so the count comes from what the engine
  // reported writing rather than from scanning the bytes.
  const written = result.log.match(/Output written on .*\.pdf \((\d+) pages?/)
  assert.ok(written, 'the log should record how many pages were written')
  assert.ok(Number(written?.[1]) >= 5, `expected at least 5 pages, found ${written?.[1]}`)

  // The figure was embedded rather than silently skipped.
  assert.match(result.log, /convergence\.png/)
})

test('keeps every artefact inside the project output directory', async () => {
  const root = await tempCopyOfExample('artefacts')
  await build({
    projectId: 'integration-3',
    root,
    settings: SETTINGS,
    onProgress: () => undefined
  })

  const top = await fs.readdir(root)
  const strays = top.filter((name) => /\.(aux|log|out|toc|lof|bbl|blg|synctex\.gz|fls)$/.test(name))
  assert.deepEqual(strays, [], 'no build artefacts may be written next to the sources')

  // \include-style subdirectories are mirrored so chapter .aux files can be written.
  await fs.access(path.join(root, '.sheaf', 'build', 'chapters'))
})

test('a project path containing spaces compiles', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'sheaf-spaces-'))
  const root = path.join(parent, 'My Thesis Project')
  await copyDirectory(EXAMPLE, root)

  const result = await build({
    projectId: 'integration-4',
    root,
    settings: SETTINGS,
    onProgress: () => undefined
  })
  assert.equal(result.status, 'success', result.error?.detail)
  await fs.access(path.join(root, '.sheaf', 'build', 'main.pdf'))
})

test('reports a real LaTeX error at the right file and line', async () => {
  const root = await tempCopyOfExample('broken')
  const target = path.join(root, 'chapters', 'results.tex')
  const original = await fs.readFile(target, 'utf8')
  const lines = original.split('\n')
  // Insert an undefined command after the chapter heading.
  lines.splice(3, 0, '\\thiscommanddoesnotexist')
  await fs.writeFile(target, lines.join('\n'), 'utf8')

  const result = await build({
    projectId: 'integration-5',
    root,
    settings: SETTINGS,
    onProgress: () => undefined
  })

  const error = result.diagnostics.find((entry) => entry.severity === 'error')
  assert.ok(error, 'expected an error diagnostic')
  assert.match(error?.message ?? '', /Undefined control sequence/)
  assert.equal(error?.file, 'chapters/results.tex')
  assert.equal(error?.line, 4)
  assert.match(error?.hint ?? '', /spelling|package/i)
})

test('a missing package produces an actionable message', async () => {
  const root = await tempCopyOfExample('missingpkg')
  const target = path.join(root, 'main.tex')
  const original = await fs.readFile(target, 'utf8')
  await fs.writeFile(
    target,
    original.replace('\\usepackage{booktabs}', '\\usepackage{sheafnosuchpackage}'),
    'utf8'
  )

  const result = await build({
    projectId: 'integration-6',
    root,
    settings: SETTINGS,
    onProgress: () => undefined
  })

  const missing = result.diagnostics.find((entry) => /not found/i.test(entry.message))
  assert.ok(missing, 'expected the missing package to be reported')
  assert.match(missing?.hint ?? '', /tlmgr install sheafnosuchpackage/)
})

test('cleaning removes the output directory and a rebuild restores it', async () => {
  const root = await tempCopyOfExample('clean')
  await build({ projectId: 'integration-7', root, settings: SETTINGS, onProgress: () => undefined })
  await fs.access(path.join(root, '.sheaf', 'build', 'main.pdf'))

  await cleanBuild(root, SETTINGS)
  await assert.rejects(() => fs.access(path.join(root, '.sheaf', 'build', 'main.pdf')))
  await fs.access(path.join(root, 'main.tex'))

  const rebuilt = await build({
    projectId: 'integration-7',
    root,
    settings: SETTINGS,
    onProgress: () => undefined
  })
  assert.equal(rebuilt.status, 'success', rebuilt.error?.detail)
})

/* ------------------------------------------------------------------ */

group('latexmk')

test('latexmk drives the whole build in one invocation when selected', async () => {
  const environment = await detectLatex()
  if (!environment.tools.latexmk) {
    console.log('    (latexmk is not installed, skipping)')
    return
  }

  const root = await tempCopyOfExample('latexmk')
  const result = await build({
    projectId: 'integration-8',
    root,
    settings: { ...SETTINGS, compiler: 'latexmk' },
    onProgress: () => undefined
  })

  assert.equal(result.status, 'success', result.error?.detail)
  assert.equal(result.passes.length, 1, 'latexmk handles the reruns itself')
  await fs.access(path.join(root, '.sheaf', 'build', 'main.pdf'))
})

/* ------------------------------------------------------------------ */

group('SyncTeX')

test('maps a source line to a place in the PDF and back again', async () => {
  const root = await tempCopyOfExample('synctex')
  const built = await build({
    projectId: 'integration-9',
    root,
    settings: SETTINGS,
    onProgress: () => undefined
  })
  assert.equal(built.status, 'success', built.error?.detail)

  const environment = await detectLatex()
  if (!environment.tools.synctex) {
    console.log('    (the synctex tool is not installed, skipping)')
    return
  }

  // A line in the middle of a paragraph that certainly produces output.
  const forward = await forwardSearch(root, SETTINGS, 'chapters/results.tex', 27, 1)
  assert.ok(forward.page >= 1, 'expected a page number')
  assert.ok(forward.x >= 0 && forward.y >= 0, 'expected coordinates on the page')

  const back = await inverseSearch(root, SETTINGS, forward.page, forward.x, forward.y)
  assert.match(back.file, /results\.tex$/, `round trip landed in ${back.file}`)
  assert.ok(Math.abs(back.line - 27) <= 6, `round trip landed on line ${back.line}`)
})

/* ------------------------------------------------------------------ */

void runAll()
