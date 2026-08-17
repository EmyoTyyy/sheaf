/* eslint-disable no-console */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { parseBib } from '../src/main/services/bib-parser'
import { parseTex } from '../src/main/services/tex-parser'
import { needsRerun, parseLatexLog } from '../src/main/services/log-parser'
import {
  classifyFile,
  isAuxFile,
  relativeToProject,
  resolveInProject,
  assertValidName
} from '../src/main/services/paths'
import { readTree, writeTextFile, createFile, renameEntry, moveEntry } from '../src/main/services/fs-service'
import { searchProject } from '../src/main/services/search-service'
import { detectMainDocument, detectProjectRoot } from '../src/main/services/project-service'
import { detectLatex, invalidateLatexCache } from '../src/main/services/latex-detect'
import { build, cleanBuild } from '../src/main/services/latex-compile'
import { createProject, duplicateProject, renameProject } from '../src/main/services/project-service'
import { exportProjectZip, importProjectZip } from '../src/main/services/archive-service'
import { TEMPLATES } from '../src/main/services/templates'
import type { ProjectSettings, TemplateId } from '../src/shared/types'

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

/**
 * The settings store resolves its location the first time it is read, so the
 * test user-data directory and the scripted engine are prepared here, before
 * any test runs, rather than inside whichever test happens to run first.
 */
const USER_DATA = mkdtempSync(path.join(os.tmpdir(), 'sheaf-userdata-'))
const FAKE_BIN = mkdtempSync(path.join(os.tmpdir(), 'sheaf-texbin-'))
process.env.SHEAF_TEST_USERDATA = USER_DATA

/**
 * A scripted stand-in for a TeX engine. It writes the .log and .pdf a real
 * engine would produce, so the whole build pipeline can be exercised without a
 * LaTeX installation present.
 */
const FAKE_ENGINE = `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "pdfTeX 3.141592653589793 (TeX Live 2023/sheaf-test)"
  exit 0
fi

outdir="."
job=""
for arg in "$@"; do
  case "$arg" in
    -output-directory=*) outdir="\${arg#-output-directory=}" ;;
    -*) ;;
    *) job="$arg" ;;
  esac
done

base=$(basename "$job" .tex)
mkdir -p "$outdir"
{
  echo "This is pdfTeX, Version 3.141592653589793 (TeX Live 2023)"
  echo "(./$job"
  echo "./$job:7: Undefined control sequence."
  echo "l.7 \\\\nosuchmacro"
  echo "LaTeX Warning: Reference \\\`fig:nowhere' on page 1 undefined on input line 9."
  echo "Output written on $outdir/$base.pdf (1 page)."
  echo ")"
} > "$outdir/$base.log"
printf '%%PDF-1.5\\n%%fake pdf produced by the test engine\\n%%%%EOF\\n' > "$outdir/$base.pdf"
exit 0
`

writeFileSync(path.join(FAKE_BIN, 'pdflatex'), FAKE_ENGINE, 'utf8')
chmodSync(path.join(FAKE_BIN, 'pdflatex'), 0o755)
writeFileSync(
  path.join(USER_DATA, 'settings.json'),
  JSON.stringify({ latex: { texBinDirectory: FAKE_BIN } }),
  'utf8'
)

/* ------------------------------------------------------------------ */
/* Tiny test harness                                                   */
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

async function runAll(): Promise<void> {
  let passed = 0
  const failures: { name: string; error: unknown }[] = []

  for (const entry of cases) {
    try {
      await entry.fn()
      passed += 1
      console.log(`  ok   ${entry.name}`)
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

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `sheaf-${prefix}-`))
}

/* ------------------------------------------------------------------ */

group('paths')

test('classifies project files by extension', () => {
  assert.equal(classifyFile('main.tex'), 'tex')
  assert.equal(classifyFile('refs.bib'), 'bib')
  assert.equal(classifyFile('custom.sty'), 'sty')
  assert.equal(classifyFile('diagram.png'), 'image')
  assert.equal(classifyFile('archive.zip'), 'binary')
})

test('recognises build artefacts', () => {
  assert.equal(isAuxFile('main.aux'), true)
  assert.equal(isAuxFile('main.synctex.gz'), true)
  assert.equal(isAuxFile('main.run.xml'), true)
  assert.equal(isAuxFile('main.tex'), false)
})

test('resolves paths inside the project', () => {
  const root = path.resolve('/tmp/project')
  assert.equal(resolveInProject(root, 'chapters/intro.tex'), path.join(root, 'chapters/intro.tex'))
  assert.equal(resolveInProject(root, '/chapters/intro.tex'), path.join(root, 'chapters/intro.tex'))
})

test('refuses to escape the project directory', () => {
  const root = path.resolve('/tmp/project')
  assert.throws(() => resolveInProject(root, '../secrets.txt'), /outside/)
  assert.throws(() => resolveInProject(root, 'a/../../b.tex'), /outside/)
  assert.throws(() => resolveInProject(root, 'chapters/../../../etc/passwd'), /outside/)
  // A leading separator means "project root", never the filesystem root.
  assert.equal(resolveInProject(root, '/etc/passwd'), path.join(root, 'etc/passwd'))
  assert.throws(() => resolveInProject(root, 'C:\\Windows\\system32'), /outside/)
})

test('rejects unusable file names', () => {
  assert.throws(() => assertValidName(''), /empty/)
  assert.throws(() => assertValidName('..'), /not a usable/)
  assert.throws(() => assertValidName('a/b.tex'), /separator/)
  assert.throws(() => assertValidName('bad:name.tex'), /not allowed/)
  assert.doesNotThrow(() => assertValidName('my chapter-1.tex'))
})

test('maps absolute paths back to project-relative ones', () => {
  const root = path.resolve('/tmp/project')
  assert.equal(relativeToProject(root, path.join(root, 'a/b.tex')), 'a/b.tex')
  assert.equal(relativeToProject(root, '/tmp/other/b.tex'), null)
})

/* ------------------------------------------------------------------ */

group('tex parser')

const SAMPLE_TEX = [
  '\\documentclass[11pt]{article}',
  '\\usepackage{amsmath,graphicx}',
  '\\newcommand{\\vect}[1]{\\mathbf{#1}}',
  '\\newenvironment{note}{\\begin{quote}}{\\end{quote}}',
  '\\begin{document}',
  '% \\label{commented:out} should be ignored',
  '\\section{Introduction}',
  '\\label{sec:intro}',
  'See Figure~\\ref{fig:one} and \\cite{knuth1984,lamport1994}.',
  '\\input{chapters/methods}',
  '\\bibliography{refs}',
  '\\end{document}'
].join('\n')

test('extracts labels, references and citations', () => {
  const index = parseTex(SAMPLE_TEX, { path: 'main.tex', mtimeMs: 1 })
  assert.deepEqual(
    index.labels.map((label) => label.name),
    ['sec:intro']
  )
  assert.deepEqual(
    index.refs.map((ref) => ref.key),
    ['fig:one']
  )
  assert.deepEqual(
    index.citations.map((citation) => citation.key),
    ['knuth1984', 'lamport1994']
  )
})

test('ignores commented-out markup', () => {
  const index = parseTex(SAMPLE_TEX, { path: 'main.tex', mtimeMs: 1 })
  assert.equal(index.labels.some((label) => label.name === 'commented:out'), false)
})

test('records the document class, packages and includes', () => {
  const index = parseTex(SAMPLE_TEX, { path: 'main.tex', mtimeMs: 1 })
  assert.equal(index.documentClass, 'article')
  assert.equal(index.hasDocumentClass, true)
  assert.deepEqual(index.packages, ['amsmath', 'graphicx'])
  assert.deepEqual(
    index.inputs.map((input) => input.target),
    ['chapters/methods']
  )
  assert.deepEqual(index.bibResources, ['refs'])
})

test('records user-defined commands and environments with their arity', () => {
  const index = parseTex(SAMPLE_TEX, { path: 'main.tex', mtimeMs: 1 })
  const vect = index.commands.find((command) => command.name === 'vect')
  assert.ok(vect, 'expected \\vect to be indexed')
  assert.equal(vect?.args, 1)
  assert.equal(index.environments.some((environment) => environment.name === 'note'), true)
})

test('attaches the nearest heading as label context', () => {
  const index = parseTex(SAMPLE_TEX, { path: 'main.tex', mtimeMs: 1 })
  assert.equal(index.labels[0].context, 'Introduction')
})

test('reports correct line numbers', () => {
  const index = parseTex(SAMPLE_TEX, { path: 'main.tex', mtimeMs: 1 })
  assert.equal(index.labels[0].line, 8)
  assert.equal(index.refs[0].line, 9)
})

/* ------------------------------------------------------------------ */

group('bib parser')

const SAMPLE_BIB = [
  '@book{knuth1984,',
  '  author    = {Knuth, Donald E.},',
  '  title     = {The {\\TeX}book},',
  '  publisher = {Addison-Wesley},',
  '  year      = 1984',
  '}',
  '',
  '@article{smith2020,',
  '  author = "Smith, Jane and Doe, John",',
  '  title  = {A study of things},',
  '  year   = {2020}',
  '}',
  '',
  '@book{knuth1984,',
  '  title = {Duplicate}',
  '}'
].join('\n')

test('parses entries, keys and fields', () => {
  const { entries } = parseBib(SAMPLE_BIB, 'refs.bib')
  assert.equal(entries.length, 3)
  assert.equal(entries[0].key, 'knuth1984')
  assert.equal(entries[0].type, 'book')
  assert.equal(entries[0].fields.publisher, 'Addison-Wesley')
  assert.equal(entries[0].fields.year, '1984')
})

test('handles quoted values and multiple authors', () => {
  const { entries } = parseBib(SAMPLE_BIB, 'refs.bib')
  const smith = entries.find((entry) => entry.key === 'smith2020')
  assert.equal(smith?.fields.author, 'Smith, Jane and Doe, John')
  assert.equal(smith?.fields.title, 'A study of things')
})

test('flags duplicate citation keys', () => {
  const { diagnostics } = parseBib(SAMPLE_BIB, 'refs.bib')
  assert.equal(
    diagnostics.some((diagnostic) => /Duplicate citation key/.test(diagnostic.message)),
    true
  )
})

test('reports an entry that is never closed', () => {
  const { diagnostics } = parseBib('@book{broken,\n  title = {No closing brace}', 'refs.bib')
  assert.equal(diagnostics.some((diagnostic) => /never closed/.test(diagnostic.message)), true)
})

test('reports a missing citation key', () => {
  const { diagnostics } = parseBib('@book{,\n title = {Nameless}\n}', 'refs.bib')
  assert.equal(diagnostics.some((diagnostic) => /no citation key/.test(diagnostic.message)), true)
})

/* ------------------------------------------------------------------ */

group('log parser')

const SAMPLE_LOG = [
  'This is pdfTeX, Version 3.141592653589793 (TeX Live 2023)',
  '(./main.tex',
  'LaTeX2e <2023-11-01>',
  '(./chapters/intro.tex',
  './chapters/intro.tex:12: Undefined control sequence.',
  'l.12 \\badcommand',
  '                  {argument}',
  ')',
  'LaTeX Warning: Reference `fig:missing\' on page 1 undefined on input line 42.',
  '',
  'Package biblatex Warning: Please (re)run Biber on the file:',
  '(biblatex)                main',
  '(biblatex)                and rerun LaTeX afterwards.',
  '',
  'Overfull \\hbox (12.5pt too wide) in paragraph at lines 55--57',
  '! LaTeX Error: File `missingpkg.sty\' not found.',
  'l.3 \\usepackage{missingpkg}',
  '',
  'LaTeX Warning: There were undefined references.',
  ')'
].join('\n')

const CONTEXT = { root: '/project', cwd: '/project', mainFile: 'main.tex' }

test('parses file:line errors and resolves the file', () => {
  const diagnostics = parseLatexLog(SAMPLE_LOG, CONTEXT)
  const undefinedCommand = diagnostics.find((entry) =>
    entry.message.startsWith('Undefined control sequence')
  )
  assert.ok(undefinedCommand, 'expected the undefined control sequence error')
  assert.equal(undefinedCommand?.severity, 'error')
  assert.equal(undefinedCommand?.file, 'chapters/intro.tex')
  assert.equal(undefinedCommand?.line, 12)
})

test('parses bare "!" errors and picks up the l.NN line marker', () => {
  const diagnostics = parseLatexLog(SAMPLE_LOG, CONTEXT)
  const missingFile = diagnostics.find((entry) => /missingpkg\.sty' not found/.test(entry.message))
  assert.ok(missingFile, 'expected the missing package error')
  assert.equal(missingFile?.severity, 'error')
  assert.equal(missingFile?.line, 3)
})

test('turns a missing .sty into an actionable hint', () => {
  const diagnostics = parseLatexLog(SAMPLE_LOG, CONTEXT)
  const missingFile = diagnostics.find((entry) => /missingpkg\.sty' not found/.test(entry.message))
  assert.match(missingFile?.hint ?? '', /tlmgr install missingpkg/)
})

test('parses undefined reference warnings with their input line', () => {
  const diagnostics = parseLatexLog(SAMPLE_LOG, CONTEXT)
  const warning = diagnostics.find((entry) => /fig:missing/.test(entry.message))
  assert.equal(warning?.severity, 'warning')
  assert.equal(warning?.line, 42)
})

test('joins multi-line package warnings', () => {
  const diagnostics = parseLatexLog(SAMPLE_LOG, CONTEXT)
  const biblatex = diagnostics.find((entry) => entry.message.startsWith('biblatex:'))
  assert.ok(biblatex, 'expected the biblatex warning')
  assert.match(biblatex?.message ?? '', /rerun LaTeX afterwards/)
})

test('reports overfull boxes as information, not errors', () => {
  const diagnostics = parseLatexLog(SAMPLE_LOG, CONTEXT)
  const overfull = diagnostics.find((entry) => entry.message.startsWith('Overfull'))
  assert.equal(overfull?.severity, 'info')
  assert.equal(overfull?.line, 55)
})

test('leaves font and package chatter out of the problems list', () => {
  const noisy = [
    'LaTeX Font Info:    External font `lmex10\' loaded for size <10.95> on input line 2.',
    'LaTeX Font Info:    Trying to load font information for T1+lmtt on input line 6.',
    'Package pdftexcmds Info: \\pdf@primitive is available.',
    'Package pdftex.def Info: images/plot.png used on input line 13.',
    '(pdftex.def)             Requested size: 341.4pt x 212.4pt.',
    'LaTeX Warning: Reference `fig:real\' on page 1 undefined on input line 42.'
  ].join('\n')

  const diagnostics = parseLatexLog(noisy, CONTEXT)
  assert.equal(diagnostics.length, 1, 'only the genuine warning should survive')
  assert.match(diagnostics[0].message, /fig:real/)
})

test('detects that another pass is required', () => {
  assert.equal(needsRerun('LaTeX Warning: Label(s) may have changed. Rerun to get'), true)
  assert.equal(needsRerun('Output written on main.pdf (3 pages).'), false)
})

/* ------------------------------------------------------------------ */

group('filesystem and search')

test('builds a tree that hides build artefacts', async () => {
  const root = await tempDir('tree')
  await fs.mkdir(path.join(root, 'chapters'))
  await fs.mkdir(path.join(root, '.sheaf'))
  await fs.writeFile(path.join(root, 'main.tex'), '\\documentclass{article}')
  await fs.writeFile(path.join(root, 'main.aux'), 'aux')
  await fs.writeFile(path.join(root, 'chapters', 'intro.tex'), 'intro')

  const tree = await readTree(root)
  const names = (tree.children ?? []).map((node) => node.name)
  assert.deepEqual(names, ['chapters', 'main.tex'])
  assert.equal(tree.children?.[0].children?.[0].name, 'intro.tex')
})

test('refuses to overwrite a file changed on disk', async () => {
  const root = await tempDir('write')
  await fs.writeFile(path.join(root, 'main.tex'), 'one')
  const stat = await fs.stat(path.join(root, 'main.tex'))

  await new Promise((resolve) => setTimeout(resolve, 20))
  await fs.writeFile(path.join(root, 'main.tex'), 'changed by another program')

  await assert.rejects(
    () => writeTextFile(root, 'main.tex', 'two', stat.mtimeMs),
    /modified outside Sheaf/
  )
  // Without the guard the write goes through.
  const written = await writeTextFile(root, 'main.tex', 'two')
  assert.ok(written.mtimeMs > 0)
  assert.equal(await fs.readFile(path.join(root, 'main.tex'), 'utf8'), 'two')
})

test('creates, renames and moves files', async () => {
  const root = await tempDir('ops')
  await fs.mkdir(path.join(root, 'chapters'))
  const created = await createFile(root, '', 'draft.tex', 'hello')
  assert.equal(created, 'draft.tex')

  const renamed = await renameEntry(root, 'draft.tex', 'intro.tex')
  assert.equal(renamed, 'intro.tex')

  const moved = await moveEntry(root, 'intro.tex', 'chapters')
  assert.equal(moved, 'chapters/intro.tex')
  assert.equal(await fs.readFile(path.join(root, 'chapters', 'intro.tex'), 'utf8'), 'hello')
})

test('searches across project files with options', async () => {
  const root = await tempDir('search')
  await fs.mkdir(path.join(root, 'chapters'))
  await fs.writeFile(path.join(root, 'main.tex'), 'Alpha beta\nGamma ALPHA\n')
  await fs.writeFile(path.join(root, 'chapters', 'a.tex'), 'alpha in a chapter\n')
  await fs.writeFile(path.join(root, 'notes.bib'), '@book{alpha2020}\n')

  const all = await searchProject(root, {
    query: 'alpha',
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    include: '',
    exclude: ''
  })
  assert.equal(all.totalMatches, 4)

  const sensitive = await searchProject(root, {
    query: 'ALPHA',
    caseSensitive: true,
    wholeWord: false,
    regex: false,
    include: '',
    exclude: ''
  })
  assert.equal(sensitive.totalMatches, 1)

  const texOnly = await searchProject(root, {
    query: 'alpha',
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    include: '*.tex',
    exclude: ''
  })
  assert.equal(texOnly.files.every((file) => file.file.endsWith('.tex')), true)

  const regex = await searchProject(root, {
    query: 'G\\w+a',
    caseSensitive: false,
    wholeWord: false,
    regex: true,
    include: '',
    exclude: ''
  })
  assert.equal(regex.totalMatches, 1)
  assert.equal(regex.files[0].matches[0].line, 2)
})

/* ------------------------------------------------------------------ */

group('project detection')

test('finds the main document by \\documentclass', async () => {
  const root = await tempDir('main')
  await fs.mkdir(path.join(root, 'chapters'))
  await fs.writeFile(path.join(root, 'chapters', 'intro.tex'), '\\section{Intro}')
  await fs.writeFile(path.join(root, 'thesis.tex'), '\\documentclass{report}\n\\begin{document}\n\\end{document}')

  assert.equal(await detectMainDocument(root, null), 'thesis.tex')
})

test('prefers main.tex when several files declare a class', async () => {
  const root = await tempDir('main2')
  await fs.writeFile(path.join(root, 'other.tex'), '\\documentclass{article}\n\\begin{document}\\end{document}')
  await fs.writeFile(path.join(root, 'main.tex'), '\\documentclass{article}\n\\begin{document}\\end{document}')

  assert.equal(await detectMainDocument(root, null), 'main.tex')
})

test('honours an explicitly configured main document', async () => {
  const root = await tempDir('main3')
  await fs.writeFile(path.join(root, 'main.tex'), '\\documentclass{article}')
  await fs.writeFile(path.join(root, 'paper.tex'), '\\documentclass{article}')
  assert.equal(await detectMainDocument(root, 'paper.tex'), 'paper.tex')
})

test('walks up from a chapter file to the project root', async () => {
  const parent = await tempDir('root')
  const root = path.join(parent, 'MyThesis')
  await fs.mkdir(path.join(root, 'chapters'), { recursive: true })
  await fs.mkdir(path.join(root, 'images'), { recursive: true })
  await fs.writeFile(path.join(root, 'main.tex'), '\\documentclass{report}\n\\begin{document}\\end{document}')
  await fs.writeFile(path.join(root, 'bibliography.bib'), '@book{a}')
  await fs.writeFile(path.join(root, 'chapters', 'introduction.tex'), '\\chapter{Intro}')

  const detected = await detectProjectRoot(path.join(root, 'chapters', 'introduction.tex'))
  assert.equal(detected, root)
})

test('falls back to the containing directory when nothing looks like a project', async () => {
  const root = await tempDir('noroot')
  await fs.writeFile(path.join(root, 'stray.tex'), 'no document class here')
  const detected = await detectProjectRoot(path.join(root, 'stray.tex'))
  assert.equal(detected, root)
})

/* ------------------------------------------------------------------ */

group('compilation pipeline')

const PROJECT_SETTINGS: ProjectSettings = {
  mainDocument: null,
  compiler: 'pdflatex',
  extraArgs: [],
  bibTool: 'none',
  outputDirectory: '.sheaf/build',
  autoCompile: false,
  autoCompileDelayMs: 1500,
  compileTimeoutMs: 30_000,
  maxPasses: 2,
  figureTemplate: ''
}

test('detects a LaTeX installation from the configured bin directory', async () => {
  invalidateLatexCache()
  const environment = await detectLatex(true)
  assert.equal(environment.detected, true)
  assert.equal(environment.distribution, 'TeX Live 2023')
  assert.equal(environment.tools.pdflatex.path, path.join(FAKE_BIN, 'pdflatex'))
  assert.ok(environment.searchedPaths.includes(FAKE_BIN))
})

test('compiles a project, produces a PDF and parses the log', async () => {
  const root = await tempDir('build')
  await fs.mkdir(path.join(root, 'chapters'))
  await fs.writeFile(
    path.join(root, 'main.tex'),
    '\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n'
  )
  await fs.writeFile(path.join(root, 'chapters', 'one.tex'), '\\section{One}')

  const phases: string[] = []
  const result = await build({
    projectId: 'test-project',
    root,
    settings: PROJECT_SETTINGS,
    onProgress: (progress) => {
      if (!progress.chunk) phases.push(progress.phase)
    }
  })

  assert.equal(result.status, 'success', result.error?.detail)
  assert.ok(result.pdfPath, 'expected a PDF path')
  assert.equal(path.basename(result.pdfPath ?? ''), 'main.pdf')
  await fs.access(result.pdfPath as string)
  assert.ok(phases.length > 0, 'expected progress updates')

  // The output directory is created and mirrors the source subdirectories.
  await fs.access(path.join(root, '.sheaf', 'build', 'chapters'))

  // Diagnostics come from the log the engine wrote, not from guesswork.
  const error = result.diagnostics.find((entry) => entry.severity === 'error')
  assert.ok(error, 'expected the scripted error to be reported')
  assert.equal(error?.file, 'main.tex')
  assert.equal(error?.line, 7)

  const warning = result.diagnostics.find((entry) => entry.severity === 'warning')
  assert.match(warning?.message ?? '', /fig:nowhere/)

  // The command that ran is recorded for the user to inspect.
  assert.match(result.passes[0].command, /-synctex=1/)
  assert.match(result.passes[0].command, /-output-directory=\.sheaf\/build/)
})

test('reports a missing engine with an actionable error instead of throwing', async () => {
  // Which engines exist depends on the machine, so pick one that is genuinely
  // absent rather than assuming.
  const environment = await detectLatex()
  const absent = (['tectonic', 'lualatex', 'xelatex', 'latexmk'] as const).find(
    (name) => !environment.tools[name]
  )
  if (!absent) {
    console.log('    (every engine is installed here, nothing to test)')
    return
  }

  const root = await tempDir('build2')
  await fs.writeFile(path.join(root, 'main.tex'), '\\documentclass{article}\n\\begin{document}\\end{document}')

  const result = await build({
    projectId: 'test-project-2',
    root,
    settings: { ...PROJECT_SETTINGS, compiler: absent },
    onProgress: () => undefined
  })

  assert.equal(result.status, 'error')
  assert.equal(result.error?.code, 'COMPILER_MISSING')
  assert.match(result.error?.title ?? '', new RegExp(absent))
  assert.match(result.error?.action ?? '', /Switch the compiler|Install a LaTeX/)
})

test('reports a project with no main document', async () => {
  const root = await tempDir('build3')
  await fs.writeFile(path.join(root, 'notes.txt'), 'nothing to compile')

  const result = await build({
    projectId: 'test-project-3',
    root,
    settings: PROJECT_SETTINGS,
    onProgress: () => undefined
  })

  assert.equal(result.error?.code, 'NO_MAIN_DOCUMENT')
})

test('cleaning removes build output but keeps the sources', async () => {
  const root = await tempDir('clean')
  await fs.writeFile(
    path.join(root, 'main.tex'),
    '\\documentclass{article}\n\\begin{document}\\end{document}'
  )
  await build({
    projectId: 'test-project-4',
    root,
    settings: PROJECT_SETTINGS,
    onProgress: () => undefined
  })
  await fs.access(path.join(root, '.sheaf', 'build', 'main.pdf'))

  await cleanBuild(root, PROJECT_SETTINGS)
  await assert.rejects(() => fs.access(path.join(root, '.sheaf', 'build', 'main.pdf')))
  await fs.access(path.join(root, 'main.tex'))
})

/* ------------------------------------------------------------------ */

group('projects, templates and archives')

test('every template produces a document with a class and a body', async () => {
  const parent = await tempDir('templates')
  for (const template of TEMPLATES) {
    const project = await createProject({
      name: `Template ${template.id}`,
      directory: parent,
      template: template.id as TemplateId
    })
    const main = await fs.readFile(path.join(project.ref.path, 'main.tex'), 'utf8')
    assert.match(main, /\\documentclass/, `${template.id} is missing \\documentclass`)
    assert.match(main, /\\begin\{document\}/, `${template.id} is missing \\begin{document}`)
    assert.match(main, /\\end\{document\}/, `${template.id} is missing \\end{document}`)
    assert.equal(project.settings.mainDocument, 'main.tex')
  }
})

test('the multi-file thesis template wires its chapters and bibliography together', async () => {
  const parent = await tempDir('thesis')
  const project = await createProject({ name: 'Thesis', directory: parent, template: 'thesis' })
  const root = project.ref.path

  const main = await fs.readFile(path.join(root, 'main.tex'), 'utf8')
  assert.match(main, /\\input\{chapters\/introduction\}/)
  assert.match(main, /\\bibliography\{bibliography\}/)

  // Every \input target and every \cite key must actually exist.
  const introduction = await fs.readFile(path.join(root, 'chapters/introduction.tex'), 'utf8')
  const bib = await fs.readFile(path.join(root, 'bibliography.bib'), 'utf8')
  const cited = [...introduction.matchAll(/\\cite\{([^}]*)\}/g)].map((match) => match[1])
  assert.ok(cited.length > 0, 'expected the template to demonstrate a citation')
  for (const key of cited) {
    assert.ok(bib.includes(`{${key},`), `citation ${key} is missing from the bibliography`)
  }
  for (const chapter of ['introduction', 'methodology', 'conclusion']) {
    await fs.access(path.join(root, 'chapters', `${chapter}.tex`))
  }
})

test('project settings are stored as plain JSON beside the sources', async () => {
  const parent = await tempDir('settings')
  const project = await createProject({ name: 'Settings', directory: parent, template: 'article' })
  const raw = await fs.readFile(path.join(project.ref.path, '.sheaf', 'settings.json'), 'utf8')
  const parsed = JSON.parse(raw)
  assert.equal(parsed.mainDocument, 'main.tex')
  assert.equal(typeof parsed.compiler, 'string')
  // The metadata directory holds no sources.
  const entries = await fs.readdir(path.join(project.ref.path, '.sheaf'))
  assert.deepEqual(entries, ['settings.json'])
})

test('creating a project twice with the same name does not collide', async () => {
  const parent = await tempDir('collide')
  const first = await createProject({ name: 'Paper', directory: parent, template: 'article' })
  const second = await createProject({ name: 'Paper', directory: parent, template: 'article' })
  assert.notEqual(first.ref.path, second.ref.path)
  assert.equal(path.basename(second.ref.path), 'Paper 2')
})

test('renaming and duplicating a project move and copy the real folder', async () => {
  const parent = await tempDir('rename')
  const project = await createProject({ name: 'Original', directory: parent, template: 'article' })

  const renamed = await renameProject(project.ref.id, 'Renamed')
  assert.equal(path.basename(renamed.path), 'Renamed')
  await fs.access(path.join(renamed.path, 'main.tex'))
  await assert.rejects(() => fs.access(project.ref.path))

  const copy = await duplicateProject(renamed.id)
  assert.equal(path.basename(copy.path), 'Renamed copy')
  await fs.access(path.join(copy.path, 'main.tex'))
})

test('exporting a project produces a ZIP of the sources without build output', async () => {
  const parent = await tempDir('export')
  const project = await createProject({ name: 'Exported', directory: parent, template: 'thesis' })
  await build({
    projectId: 'export-project',
    root: project.ref.path,
    settings: PROJECT_SETTINGS,
    onProgress: () => undefined
  })

  const archive = path.join(parent, 'Exported.zip')
  await exportProjectZip(project.ref.path, archive)

  const AdmZip = (await import('adm-zip')).default
  const names = new AdmZip(archive).getEntries().map((entry) => entry.entryName)
  assert.ok(names.includes('Exported/main.tex'))
  assert.ok(names.includes('Exported/chapters/introduction.tex'))
  assert.ok(names.includes('Exported/bibliography.bib'))
  assert.equal(
    names.some((name) => name.includes('.sheaf/')),
    false,
    'the archive must not carry build output or application metadata'
  )
})

test('importing a ZIP recreates the project and strips the shared top folder', async () => {
  const parent = await tempDir('import')
  const source = await createProject({ name: 'Roundtrip', directory: parent, template: 'thesis' })
  const archive = path.join(parent, 'Roundtrip.zip')
  await exportProjectZip(source.ref.path, archive)

  const destination = await tempDir('imported')
  const imported = await importProjectZip(archive, destination)

  await fs.access(path.join(imported, 'main.tex'))
  await fs.access(path.join(imported, 'chapters', 'methodology.tex'))
  assert.equal(
    await fs.readFile(path.join(imported, 'main.tex'), 'utf8'),
    await fs.readFile(path.join(source.ref.path, 'main.tex'), 'utf8')
  )
})

test('a ZIP that tries to escape its destination is rejected entry by entry', async () => {
  const parent = await tempDir('zipslip')
  const AdmZip = (await import('adm-zip')).default
  const zip = new AdmZip()
  zip.addFile('project/main.tex', Buffer.from('\\documentclass{article}'))
  zip.addFile('../escaped.tex', Buffer.from('should never be written'))
  const archive = path.join(parent, 'evil.zip')
  zip.writeZip(archive)

  const destination = await tempDir('zipdest')
  const imported = await importProjectZip(archive, destination)

  // The safe entry is kept. Its own folder survives because the archive has no
  // single shared top-level directory to strip.
  await fs.access(path.join(imported, 'project', 'main.tex'))
  // The traversing entry is dropped rather than written outside the target.
  await assert.rejects(() => fs.access(path.join(destination, 'escaped.tex')))
  await assert.rejects(() => fs.access(path.join(path.dirname(destination), 'escaped.tex')))
})

/* ------------------------------------------------------------------ */

void runAll()
