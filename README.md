# Sheaf

A local-first LaTeX editor. Projects are ordinary folders of `.tex` files on your
own disk, and they are compiled by the TeX distribution installed on your
machine. No account, no server, no cloud storage — the application works with the
network switched off.

> A *sheaf* is both a bundle of pages and an object in mathematics. It seemed
> like the right name for a tool that gathers loose LaTeX files into a document.

Website: <https://emyotyyy.github.io/sheaf/> (source in [`docs/`](docs)).

---

## Requirements

| | |
|---|---|
| Node.js | 18 or newer (for development only) |
| A TeX distribution | TeX Live, MiKTeX or Tectonic — **required for compiling** |

Sheaf never bundles or fakes a compiler. Without a TeX distribution you can still
create, open and edit projects; pressing **Compile** then reports exactly what is
missing and how to install it.

```bash
# Debian / Ubuntu — a good starting set
sudo apt install texlive-latex-recommended texlive-latex-extra latexmk biber

# Fedora
sudo dnf install texlive-scheme-medium latexmk biber

# macOS
brew install --cask mactex-no-gui

# Windows
winget install MiKTeX.MiKTeX
```

If the distribution lives somewhere unusual, set the directory holding its
binaries under **Settings → LaTeX → TeX bin directory**; Sheaf verifies whatever
it finds there by executing it, and shows you every location it probed.

---

## Getting started

```bash
npm install          # also copies the pdf.js font and cmap assets
npm run dev          # development, with hot reload for the interface
npm test             # 47 tests over the parsers, filesystem and build pipeline
npm run test:latex   # 12 more against your real TeX installation
npm run build        # typecheck plus a production bundle in out/
npm run dist:linux   # .deb and AppImage in release/
npm run dist:win     # NSIS installer and portable .exe in release/
```

### Try it on the example project

`examples/demo-thesis/` is a small multi-file thesis built to exercise the
parts that are easy to get wrong: four chapters pulled in with `\input`, a
bibliography, a figure, a table, cross-references and maths. Open that folder
from the dashboard and press <kbd>Ctrl</kbd>+<kbd>Enter</kbd>.
[`examples/demo-thesis/TESTING.md`](examples/demo-thesis/TESTING.md) walks
through what to check, including how to break the document on purpose and
watch the Problems panel find it.

`npm run dist` also accepts `dist:win` and `dist:mac`. Before publishing
packages, change the placeholder `homepage` field in `package.json`.

> Running inside a VS Code integrated terminal? VS Code sets
> `ELECTRON_RUN_AS_NODE=1`, which makes Electron start as plain Node. Launch with
> `env -u ELECTRON_RUN_AS_NODE npm run dev` in that case.

---

## What it does

**Projects are plain folders.** A project is a directory you can open in any
other editor, sync with any tool, and commit to git as-is. The only thing Sheaf
adds is `.sheaf/settings.json` for per-project build settings and
`.sheaf/build/` for compiler output. Neither ever holds your source.

**Compilation is real and local.** `pdflatex`, `xelatex`, `lualatex`, `latexmk`
and `tectonic` are supported. Sheaf detects installed engines, runs them with an
argument array (never through a shell), streams their output, reruns them when
cross-references have not settled, and invokes `biber` or `bibtex` when the
document needs it. Every command that ran is shown in **Raw Log**, and the exact
build command is displayed under **Settings → Project**.

**Errors are parsed, not dumped.** The compiler log is turned into a list of
errors, warnings and informational messages with file, line and column. Clicking
one opens the file and jumps to the spot. Common failures carry an explanation —
a missing `.sty` becomes "the package *xcolor* is not installed; run
`tlmgr install xcolor`".

**The project is indexed.** Every `.tex` and `.bib` file is parsed to collect
labels, references, citations, `\newcommand` definitions and the `\input` graph.
That index drives completion of `\ref{`, `\cite{`, `\begin{`, `\usepackage{` and
file arguments, and it reports undefined references, undefined citations,
duplicate labels, uncited bibliography entries and malformed BibTeX — before you
compile. Only files whose modification time changed are re-parsed.

**Source and PDF stay in step.** `Ctrl+Alt+Click` in the editor highlights the
matching place in the PDF; clicking in the PDF jumps to the line that produced
it. Both use SyncTeX, and both explain themselves rather than failing silently
when SyncTeX has no answer.

**The PDF viewer is built in.** pdf.js renders the document with zoom, fit
width/page, thumbnails, in-document search, full screen and export. A failed
build never destroys the PDF you already had.

Also: file explorer with drag and drop, editor tabs with unsaved indicators,
autosave, project-wide search, quick open, a command runner, optional git
integration, ZIP import/export, seven starter templates, light and dark themes,
and a distraction-free mode.

---

## Architecture

The spec suggested Tauri. This build uses **Electron** instead, for one
practical reason: Tauri needs a Rust toolchain and `libwebkit2gtk-4.1-dev`
system packages, neither of which could be installed in the target environment.
Electron provides everything the specification actually requires — direct
filesystem access, spawning local compiler processes, single-instance IPC, OS
file associations and command-line file arguments — with `npm install` alone.
The cost is a larger runtime (~110 MB packaged instead of ~10 MB).

```
┌──────────────────────────────────────────────────────────┐
│  Renderer  (React + TypeScript, sandboxed, no Node)      │
│  Monaco editor · pdf.js viewer · zustand stores          │
└───────────────────────────┬──────────────────────────────┘
                            │ contextBridge: one named
                            │ function per operation
┌───────────────────────────┴──────────────────────────────┐
│  Main process  (Node)                                    │
│  projects · filesystem · indexing · compilation ·        │
│  log parsing · SyncTeX · search · git · terminal         │
└───────────────────────────┬──────────────────────────────┘
                            │ argument arrays, never a shell
              ┌─────────────┴─────────────┐
              │  Local filesystem + TeX   │
              └───────────────────────────┘
```

```
src/
├── shared/            Types, IPC channel names and the API contract
│   ├── types.ts       Everything crossing the process boundary
│   ├── api.ts         The complete surface the renderer may call
│   └── ipc.ts         Channel names
├── main/              Node side
│   ├── index.ts       Lifecycle, single instance, CLI file arguments
│   ├── window.ts      Window creation and the security policy
│   ├── menu.ts        Application menu
│   ├── ipc.ts         Handler registration, one guarded wrapper each
│   └── services/
│       ├── paths.ts           Path validation — the choke point for all file access
│       ├── errors.ts          AppError model; nothing throws across IPC
│       ├── fs-service.ts      Reading, writing, moving, the project tree
│       ├── project-service.ts Projects, templates, main-document and root detection
│       ├── latex-detect.ts    Finding TeX Live / MiKTeX / Tectonic
│       ├── latex-compile.ts   The build pipeline
│       ├── log-parser.ts      Compiler log → diagnostics
│       ├── tex-parser.ts      Labels, refs, citations, commands, includes
│       ├── bib-parser.ts      BibTeX entries and their problems
│       ├── index-service.ts   Incremental project index and cross-file analysis
│       ├── search-service.ts  Project-wide search
│       ├── synctex-service.ts Forward and inverse search
│       ├── git-service.ts     Optional source control
│       ├── terminal-service.ts User-requested commands
│       ├── watcher-service.ts Filesystem events
│       ├── archive-service.ts ZIP import and export
│       └── os-integration.ts  File associations
├── preload/           The contextBridge, and nothing else
└── renderer/src/
    ├── components/    Explorer, editor, PDF pane, panels, dialogs
    ├── state/         zustand stores: project, editor, build, settings, ui
    ├── latex/         Monaco language, themes, completion, LaTeX data
    └── lib/           Commands, models, paths, IPC helpers
```

---

## Opening files from the operating system

The installers register Sheaf for `.tex`, `.ltx`, `.bib`, `.sty` and `.cls`, so
double-clicking a LaTeX file opens it here. On Linux the running application can
also claim the association itself from **Settings → Application**, which writes
a desktop entry and calls `xdg-mime`. On Windows the NSIS installer does it; on
macOS the document types are declared in the application bundle.

Opening a file never creates a throwaway one-file project. Sheaf walks up from
the file, scoring each ancestor directory on LaTeX-project indicators — a
`\documentclass`, a `main.tex`, `.bib` and `.sty` files, a `chapters/` or
`images/` directory, existing Sheaf metadata — and opens the best match, then
focuses the file inside it. Only one instance runs: a second file opens as a new
tab in the window you already have.

```bash
sheaf ~/Documents/Thesis/chapters/introduction.tex
# opens ~/Documents/Thesis as the project, with introduction.tex focused
```

---

## The Linux sandbox

Chromium sandboxes its renderer in one of two ways: an unprivileged user
namespace, or a small `chrome-sandbox` helper that must be owned by root with
mode 4755. Ubuntu 24.04 denies unprivileged user namespaces to unconfined
programs, and an AppImage is a read-only, `nosuid` mount that cannot carry a
setuid file, so on those machines Chromium used to abort before a single line
of Sheaf ran:

```
FATAL:setuid_sandbox_host.cc(158)] The SUID sandbox helper binary was found,
but is not configured correctly. Rather than run without sandboxing I'm
aborting now.
```

Nothing in the application could fix that, because the process was dead before
the main script started. So `scripts/after-pack.cjs` puts a short launcher in
front of the binary:

| What happens | What the launcher does |
|---|---|
| `chrome-sandbox` is setuid root (the `.deb`) | launches normally, sandbox on |
| the application starts | nothing, sandbox on |
| it dies on a signal within seconds of starting | prints why, then starts it again with `--no-sandbox` |

The launcher deliberately does **not** try to predict the answer. Asking the
kernel through another program, `unshare` for instance, produces a confident
lie: AppArmor decides this per executable, and Ubuntu ships a profile that lets
`unshare` create a namespace while denying the same thing to an unprofiled
AppImage. Chromium's own verdict is the only reliable one, and it arrives in a
fraction of a second, before a window is drawn, the single-instance lock is
taken or any file is touched, which is what makes starting over safe. A crash
later in a session looks nothing like that and is left alone.

**The `.deb` keeps the sandbox in every case** and is the better package on
Debian and Ubuntu.

To keep the sandbox with an AppImage on Ubuntu 24.04, grant it the permission
it is missing and the launcher will leave the sandbox alone:

```bash
# Adjust the path to wherever you keep the AppImage.
sudo tee /etc/apparmor.d/sheaf-appimage >/dev/null <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>

profile sheaf-appimage "/home/*/Applications/Sheaf-*.AppImage" flags=(unconfined) {
  userns,
  include if exists <local/sheaf-appimage>
}
PROFILE
sudo apparmor_parser -r /etc/apparmor.d/sheaf-appimage
```

---

## Security

Executing local processes deserves care, so the three kinds of process are kept
visibly apart:

* **File operations** never touch a process. Every path from the renderer is
  resolved through a single function that rejects traversal, refuses absolute
  paths, and re-checks the result after following symlinks. A leading `/` means
  "project root", never the filesystem root.
* **Compilation** spawns the engine with an argument array and `shell: false`,
  so a file name containing spaces or shell metacharacters is inert. The output
  directory is passed relative to the project, keeping every artefact provably
  inside it. Builds are cancellable and time out.
* **Terminal commands** are the only path that involves a shell, they run only
  what the user typed, only in the project directory, and only when asked.

The renderer runs with context isolation on and Node integration off; its only
capability is the named function list in `src/shared/api.ts`. Packaged builds
apply a strict Content-Security-Policy, navigation away from the application is
blocked, and external links open in the system browser. ZIP import rejects
entries that would escape the destination.

---

## Known limitations

Everything listed here is deliberately absent rather than stubbed:

* **The terminal is a command runner, not a pseudo-terminal.** Output streams
  back and commands can be stopped, but programs that need an interactive TTY
  (`vim`, `top`, a password prompt) will not work. A real PTY would require a
  native module.
* **Git is intentionally small**: status, diff, stage, unstage, commit,
  fast-forward pull and push. Merges, rebases and conflict resolution belong in
  a real git client. Credential prompts are disabled, so authenticated pushes
  need a configured helper.
* **The interface is English only.** No translation layer is included, so no
  language selector is offered.
* **Spell checking is not wired into the editor.** Electron's checker does not
  reach inside Monaco's rendering.
* `latexmk` is driven with `-pdf`; to use it with XeLaTeX or LuaLaTeX, add
  `-pdfxe` or `-pdflua` to the project's extra arguments.

---

## Testing

### `npm test` — 47 tests, no LaTeX required

These run against the real service modules, with Electron replaced by a small
stub:

* path validation and traversal refusal
* the LaTeX parser: labels, references, citations, commands, includes, comments
* the BibTeX parser, including malformed input
* the log parser: `file:line` errors, bare `!` errors with `l.NN` markers,
  multi-line package warnings, overfull boxes, rerun detection, package hints
* filesystem operations, including refusing to overwrite a file changed on disk
* project-wide search with case, regex and glob options
* main-document and project-root detection
* **the full build pipeline** — a scripted stand-in for a TeX engine lets the
  test assert that the right command is constructed, the output directory is
  mirrored, the PDF is produced, and the log is parsed into diagnostics, all
  without a LaTeX installation
* every template compiles-shaped: document class, body, chapters that exist and
  citations that resolve against the bundled bibliography
* ZIP export and import round-trip, including rejection of archive entries that
  try to write outside the destination

### `npm run test:latex` — 12 tests against your own TeX installation

Kept separate so the suite above stays green on machines without TeX. These
compile `examples/demo-thesis` for real and check that:

* the installed engines are detected and identified
* a clean build succeeds with no errors, after `bibtex` and enough reruns for
  every cross-reference and the list of figures to settle
* the PDF has the expected number of pages and the figure was embedded
* no artefact is written next to the sources, and `\input` subdirectories are
  mirrored into the output directory
* a project path containing spaces compiles
* a deliberate `\undefinedcommand` is reported on the right file and line, and
  a missing package produces the `tlmgr install` hint
* `latexmk` resolves the whole build in a single invocation
* SyncTeX maps a source line into the PDF and back to within a few lines

---

## Website

`docs/` is the project page published at <https://emyotyyy.github.io/sheaf/>. It
is plain HTML, CSS and one small script: no build step, no dependency to install,
and nothing is fetched from a third party at runtime. The fonts are self-hosted
and the screenshots are captures of the real application compiling
`examples/demo-thesis`, in both the light and the dark theme.

To publish it, push the repository and set **Settings → Pages → Source** to
*Deploy from a branch*, branch `main`, folder `/docs`.

To work on it, open `docs/index.html` in a browser, or serve the folder:

```bash
python3 -m http.server -d docs 8000
```

The icon is drawn from one description in `scripts/make-icons.py`: a leaf whose
veins are lines of text. It writes every size the packagers need plus the SVG
the website uses, so they cannot drift apart.

```bash
python3 scripts/make-icons.py
```

The screenshots are regenerated by driving the application, so the page cannot
drift into showing something the application does not do:

```bash
npm run build
node scripts/site-screenshots.cjs     # captures both themes into out/site-shots
python3 scripts/site-crops.py         # cuts docs/assets from those captures
```

The capture run compiles the example project twice, breaks a chapter on purpose
to photograph a real error, and then puts the file back.

---

## Licence

MIT. See [LICENSE](LICENSE).
