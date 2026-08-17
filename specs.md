# Build a Local-First LaTeX Editor

Build a polished, fully local LaTeX editor inspired by Overleaf. The goal is **not** to reproduce Overleaf's online/cloud architecture, but to create a desktop/local web application that provides a similar editing experience while keeping all projects and compilation completely local.

The application should feel like a serious IDE for LaTeX rather than a basic text editor.

## 1. Core Concept

Create a **local-first LaTeX development environment** with:

* A LaTeX source-code editor
* Local project management
* A file explorer
* LaTeX compilation
* Live PDF preview
* Sync between source code and PDF
* Error and warning reporting
* Search across project files
* Multiple files per project
* Assets such as images, bibliographies, and custom `.sty` files
* Project settings
* Auto-save
* Syntax highlighting
* Autocompletion
* Code diagnostics
* A terminal/log output
* Completely local data storage

The application must work without an internet connection once installed.

Do **not** require a cloud account, server account, online database, or external SaaS service.

---

# 2. Target Experience

The interface should be strongly inspired by modern IDEs and Overleaf.

The default layout should contain three main areas:

### Left — Project Explorer

Display the project structure as a file tree.

Example:

```text
My Thesis/
├── main.tex
├── chapters/
│   ├── introduction.tex
│   ├── methodology.tex
│   └── conclusion.tex
├── images/
│   ├── diagram.png
│   └── graph.pdf
├── bibliography.bib
└── references.bib
```

The explorer should support:

* Creating files
* Creating folders
* Renaming files
* Deleting files
* Moving files
* Drag and drop
* Uploading/importing files
* Opening files
* Context menus
* File type icons
* Expand/collapse folders

Double-clicking a `.tex` file should open it in the editor.

---

# 3. Main Editor

Use a professional code editor such as **Monaco Editor** or another appropriate editor component.

The editor must provide:

* LaTeX syntax highlighting
* Line numbers
* Current-line highlighting
* Bracket matching
* Code folding
* Automatic indentation
* Undo/redo
* Multi-cursor editing
* Find and replace
* Find in project
* Keyboard shortcuts
* Automatic saving
* Unsaved-change indicators
* Dark and light themes
* Customizable font size
* Word wrapping toggle

LaTeX-specific features should include:

* Command autocomplete
* Environment autocomplete
* `\begin{...}` / `\end{...}` pairing
* Common command suggestions
* Package suggestions where possible
* Citation autocomplete from `.bib` files
* Label/reference autocomplete
* Detection of undefined references
* Detection of undefined citations
* Detection of common LaTeX syntax errors

Example:

When the user types:

```latex
\begin{
```

the editor should suggest environments such as:

```text
document
itemize
enumerate
figure
table
equation
align
center
abstract
```

When typing:

```latex
\cite{
```

the editor should suggest citation keys found in the project's `.bib` files.

---

# 4. PDF Preview

The right side of the interface should contain an integrated PDF viewer.

After compilation, automatically display the generated PDF.

The viewer should support:

* Zoom
* Fit width
* Fit page
* Page navigation
* Page thumbnails
* Search inside PDF
* Full-screen mode
* Download/export PDF
* Refresh/recompile

The editor and PDF preview should update automatically after successful compilation.

Do not require the user to open the PDF in an external application.

---

# 5. Source ↔ PDF Synchronization

Implement synchronization between the source editor and PDF preview where technically possible.

For example:

* Clicking a location in the PDF should attempt to jump to the corresponding LaTeX source.
* A keyboard shortcut such as `Ctrl+Click` or `Ctrl+Alt+Click` in the editor should attempt to jump to the corresponding PDF location.

Use SyncTeX when available.

If SyncTeX cannot determine an exact location, gracefully fall back instead of breaking the application.

---

# 6. LaTeX Compilation

The application must compile LaTeX **locally**.

Do not implement fake compilation.

The application should detect installed LaTeX distributions such as:

* TeX Live
* MiKTeX

The application should allow the user to configure the LaTeX executable path manually if automatic detection fails.

Support common compilation engines:

* `pdflatex`
* `xelatex`
* `lualatex`

The project should have a configurable compiler setting.

Example:

```text
Compiler:
[xelatex ▼]

Build command:
xelatex -synctex=1 -interaction=nonstopmode main.tex
```

The application should execute compilation through a safe local process.

---

# 7. Compilation Workflow

Provide a prominent:

**Build / Compile**

button.

Also support:

```text
Ctrl + S
```

for saving and optionally:

```text
Ctrl + Enter
```

for compiling.

Add an optional:

**Auto Compile**

mode.

When enabled:

1. User modifies the source.
2. Application waits for a short debounce period.
3. Application saves the file.
4. Application compiles the project.
5. If compilation succeeds, refresh the PDF.
6. If compilation fails, preserve the previous valid PDF and display the errors.

Do not continuously compile on every keystroke.

Use a sensible debounce mechanism.

---

# 8. Compilation Errors

Create a dedicated **Problems / Build Output** panel.

Display:

* Errors
* Warnings
* Info messages
* File
* Line number
* Column when available
* Error message

Example:

```text
ERROR
main.tex:42: Undefined control sequence

WARNING
chapter1.tex:87: Reference `fig:architecture' undefined
```

Clicking an error should automatically:

1. Open the relevant file.
2. Jump to the relevant line.
3. Highlight the relevant location.

Parse the LaTeX compiler output rather than simply displaying raw terminal output.

Also provide a **Raw Log** tab containing the original compiler output for advanced users.

---

# 9. Project Management

The application should have a project dashboard.

Users should be able to:

* Create a project
* Open a project
* Rename a project
* Delete a project
* Duplicate a project
* Import a project
* Export a project
* Open an existing local folder as a project

Creating a project should offer templates such as:

```text
Blank Document
Article
Report
Book
Thesis
Presentation (Beamer)
Letter
```

Templates should generate valid starter LaTeX projects.

For example, an Article project should contain a working `main.tex`.

---

# 10. Local Storage

Projects must remain local.

Do not store project source code in a remote database.

The preferred architecture is:

```text
Application
    ↓
Local filesystem
    ↓
LaTeX compiler
    ↓
Generated PDF
```

A project should correspond to an actual directory on the user's computer.

Example:

```text
~/Documents/LaTeX Projects/My Thesis/
```

The application should read and write files directly from this project directory.

Avoid converting the entire project into an opaque proprietary database format.

The user should always be able to open the project directory independently of the application.

---

# 11. Import / Export

Support importing existing LaTeX projects.

The user should be able to select a directory containing:

```text
.tex
.bib
.sty
.cls
.png
.jpg
.jpeg
.svg
.pdf
```

and open it as a project.

Also support importing `.zip` LaTeX projects.

Export should allow:

* Export project as ZIP
* Export generated PDF

The exported ZIP should contain the actual LaTeX source/project files rather than application-specific metadata whenever possible.

---

# 12. Bibliography Support

Provide useful `.bib` integration.

The application should:

* Detect `.bib` files
* Parse bibliography entries
* Autocomplete citation keys
* Detect missing citation keys
* Detect unused bibliography entries where possible
* Highlight malformed BibTeX entries
* Allow opening the bibliography file directly

Example:

Typing:

```latex
\cite{
```

could display:

```text
smith2024
johnson2023
einstein1905
```

with useful metadata such as author and title.

---

# 13. Images and Assets

The project explorer should recognize image files.

Allow users to drag an image into the editor.

For example, dropping:

```text
architecture.png
```

into the editor could insert:

```latex
\begin{figure}[ht]
    \centering
    \includegraphics[width=\textwidth]{images/architecture.png}
    \caption{Architecture}
    \label{fig:architecture}
\end{figure}
```

The exact insertion behavior can be configurable.

---

# 14. Search

Implement both:

### Search in current file

and:

### Search across entire project

Project search should search:

* `.tex`
* `.bib`
* `.sty`
* `.cls`
* Other text-based project files

Results should show:

```text
main.tex:42
chapter1.tex:17
chapter2.tex:91
```

Clicking a result should open the file and jump to that line.

---

# 15. Settings

Create a dedicated settings page.

Include:

### Editor

* Font
* Font size
* Tab size
* Spaces vs tabs
* Word wrapping
* Minimap
* Line numbers
* Theme

### LaTeX

* Compiler
* Compiler path
* Build command
* Main document
* Auto compile
* Compile timeout

### PDF

* Zoom behavior
* PDF panel position
* Auto-refresh

### Application

* Theme
* Language
* Autosave
* Project directory

Settings should persist locally.

---

# 16. Multiple LaTeX Files

The editor must properly handle multi-file LaTeX projects.

For example:

```latex
\input{chapters/introduction}
\include{chapters/methodology}
```

The application should understand the project structure.

The user should be able to open multiple files simultaneously using editor tabs.

Example:

```text
[ main.tex ] [ introduction.tex ] [ methodology.tex ]
```

Unsaved files should display an indicator.

---

# 17. Main Document Detection

The application should intelligently identify the main LaTeX document.

Prioritize:

1. User-configured main document.
2. A `.tex` file containing `\documentclass`.
3. `main.tex`.

Allow the user to manually change the root document.

This is important for projects containing multiple `.tex` files.

---

# 18. Terminal / Advanced Tools

Include an optional terminal panel.

The terminal should operate inside the current project directory.

Example:

```bash
$ ls
main.tex
chapters/
images/
bibliography.bib
```

This is intended for advanced users who want to run commands such as:

```bash
latexmk
biber
bibtex
make
git
```

Do not make the terminal necessary for normal operation.

---

# 19. Git Integration

If practical, provide basic Git integration.

Detect whether the project is a Git repository.

Display:

* Current branch
* Modified files
* Untracked files
* Staged files

Allow basic operations:

* Commit
* Pull
* Push
* View diff

Git must remain optional. The application must work perfectly without Git.

Do not build a complicated Git client unless it can be implemented reliably.

---

# 20. UI Design

The interface should look like a modern professional developer application.

Use a clean three-panel layout:

```text
┌───────────────────────────────────────────────────────────────┐
│ Toolbar                                                       │
├──────────────┬──────────────────────────┬─────────────────────┤
│              │                          │                     │
│   Explorer   │       LaTeX Editor      │      PDF Preview    │
│              │                          │                     │
│   Files      │                          │                     │
│   Folders    │                          │                     │
│              │                          │                     │
├──────────────┴──────────────────────────┴─────────────────────┤
│ Problems / Build Output / Terminal                           │
└───────────────────────────────────────────────────────────────┘
```

Panels should be resizable.

Allow the user to:

* Collapse the explorer
* Collapse the bottom panel
* Expand the PDF
* Enter distraction-free mode
* Switch between editor/PDF layouts

The interface should be responsive but optimized primarily for desktop screens.

Avoid excessive rounded cards, gradients, decorative elements, or unnecessary animations.

This is a developer tool, so prioritize:

**clarity → information density → speed → usability → aesthetics.**

---

# 21. Keyboard Shortcuts

Implement sensible shortcuts.

At minimum:

```text
Ctrl + S          Save
Ctrl + Enter      Compile
Ctrl + P          Quick Open
Ctrl + Shift + F  Search Project
Ctrl + F          Find
Ctrl + H          Replace
Ctrl + Z          Undo
Ctrl + Shift + Z  Redo
Ctrl + B          Toggle sidebar
Ctrl + J          Toggle bottom panel
```

Make shortcuts configurable if practical.

---

# 22. Architecture

Choose a robust architecture appropriate for a local desktop application.

A strong option would be:

```text
Frontend:
React + TypeScript

Editor:
Monaco Editor

Desktop shell:
Tauri

Backend/local process layer:
Rust

Storage:
Local filesystem

LaTeX:
TeX Live / MiKTeX installed on host system

PDF:
Embedded PDF.js viewer
```

However, you may choose an alternative architecture if there is a strong technical reason.

The critical requirement is that **the application must be able to safely communicate with the local filesystem and launch local LaTeX compiler processes.**

Do not create a fake browser-only implementation that cannot access the user's filesystem or execute LaTeX.

---

# 23. Security

Because the application executes local processes, security must be taken seriously.

Do not allow arbitrary commands to be executed silently.

Clearly distinguish between:

* File operations
* LaTeX compilation
* User-requested terminal commands

Validate paths and prevent path traversal outside the project when performing normal project operations.

Do not execute LaTeX files through a shell using unsafe string concatenation.

Use proper process APIs and argument arrays.

---

# 24. Performance

The application should remain responsive while LaTeX is compiling.

Compilation must run asynchronously and must not freeze the UI.

Large projects should remain usable.

Avoid reloading the entire project whenever a single file changes.

Use incremental updates where appropriate.

---

# 25. Error Handling

Never allow a compilation error to crash the application.

Examples:

* LaTeX not installed
* Compiler executable missing
* Compilation timeout
* Invalid project
* Corrupted `.tex` file
* Missing image
* Missing package
* Permission error
* PDF generation failure

Display actionable errors.

For example:

```text
LaTeX compiler not found.

No TeX Live or MiKTeX installation could be detected.

Install a LaTeX distribution or configure the compiler path in Settings → LaTeX.
```

Do not show cryptic internal errors when a useful explanation can be provided.

---

# 26. Project File Format

Do not invent a proprietary format for source files.

The actual project should consist of normal files:

```text
project/
├── main.tex
├── chapters/
├── images/
├── bibliography.bib
└── ...
```

Only application-specific metadata should be stored separately, for example:

```text
.project/
    settings.json
```

The `.project` directory should never contain the actual source of the document.

---

# 27. Offline Requirement

The application must function without internet access.

Internet access may optionally be used for future features such as:

* Package discovery
* Documentation lookup
* CTAN search

but these must never be required for:

* Opening projects
* Editing files
* Saving files
* Compiling documents
* Viewing PDFs
* Searching projects

---

# 28. Initial MVP

Do not attempt to implement every feature simultaneously.

Build the application incrementally.

### Phase 1 — Core

Implement:

* Project creation/opening
* Local filesystem project
* File explorer
* Monaco LaTeX editor
* File tabs
* Save/autosave
* Local LaTeX compilation
* PDF viewer
* Build output
* Error navigation

The result of Phase 1 must already be a genuinely usable local LaTeX editor.

### Phase 2 — LaTeX intelligence

Add:

* Autocomplete
* Citation autocomplete
* Label/reference autocomplete
* Diagnostics
* SyncTeX
* Image drag/drop
* Templates

### Phase 3 — Advanced IDE features

Add:

* Project search
* Terminal
* Git integration
* Advanced settings
* Custom shortcuts
* Distraction-free mode
* Import/export

Do not build placeholder UI for features that do not actually work.

---

# 29. Important Development Rules

Prioritize functionality over visual mockups.

Do not:

* Fake LaTeX compilation
* Fake PDF generation
* Store projects only in browser localStorage
* Create a single giant HTML file
* Pretend to support features that are not implemented
* Hard-code paths to LaTeX installations
* Freeze the UI during compilation
* Rewrite entire project files unnecessarily
* Destroy the previous PDF when a new compilation fails

Every major feature should be implemented using a real underlying mechanism.

The application should be modular and maintainable.

Separate:

```text
UI
Editor
Project management
Filesystem
Compilation
PDF handling
Diagnostics
Settings
Git
```

into distinct modules/services.

---

# 30. Deliverable

Create the complete working application, not merely a prototype or UI mockup.

Start by designing the architecture and project structure.

Then implement the MVP.

After the MVP works, progressively add the advanced features.

At every stage:

1. Keep the application runnable.
2. Test the feature.
3. Fix errors before moving on.
4. Do not introduce fake functionality.
5. Keep the codebase clean and modular.

The final result should feel like:

**“Overleaf, but installed on my computer, with my projects stored as normal local files and LaTeX compiling directly on my machine.”**

# 31. Operating System Integration

The application must integrate with the operating system as a proper desktop application.

## File Associations

Allow the application to register itself as a default application for LaTeX-related files.

At minimum, support:

```text
.tex
.bib
.sty
.cls
```

The primary association should be:

```text
.tex → This LaTeX Editor
```

When the user double-clicks a `.tex` file in their file manager, the application should automatically launch and open that file.

Example:

```text
Double-click:
~/Documents/Thesis/main.tex

        ↓

LaTeX Editor launches

        ↓

Project containing main.tex is opened

        ↓

main.tex is opened in the editor
```

## Opening Individual Files

The application must support being launched with a file path as an argument.

For example:

```text
latex-editor /home/user/Documents/Thesis/main.tex
```

The application should detect that the file belongs to a LaTeX project and automatically:

1. Determine the project root.
2. Open the project.
3. Open the selected `.tex` file.
4. Focus the editor on that file.

Do not create a new isolated project containing only the opened file.

## Project Detection

When a `.tex` file is opened directly, intelligently determine its project root.

For example, if the user opens:

```text
MyThesis/chapters/introduction.tex
```

and the directory contains:

```text
MyThesis/
├── main.tex
├── chapters/
│   ├── introduction.tex
│   └── conclusion.tex
├── images/
└── bibliography.bib
```

the application should recognize `MyThesis/` as the project and open the complete project.

The detection algorithm should look for indicators such as:

* A `.tex` file containing `\documentclass`
* `main.tex`
* `.bib` files
* `.sty` files
* `.cls` files
* Common LaTeX project structure
* Application-specific project metadata, if present

If no clear project root can be found, use the directory containing the opened file.

## Multiple Files

If the application is already running and the user double-clicks another `.tex` file, do not necessarily launch a second application instance.

Prefer communicating with the existing instance and opening the file in a new editor tab.

If technically appropriate, implement a single-instance application with an IPC mechanism.

Example:

```text
Application already running
        +
User double-clicks chapter.tex
        ↓
Existing application receives file path
        ↓
Project is opened/focused
        ↓
chapter.tex becomes the active tab
```

## OS-Specific Integration

Implement proper native file associations for the operating systems supported by the application.

At minimum, target:

* Linux
* Windows
* macOS

The installer/package should register the appropriate MIME types/file associations.

For Linux, correctly register the application for `text/x-tex` and relevant LaTeX MIME types.

For Windows, register the appropriate file extensions through the application installer.

For macOS, declare the appropriate document types and extensions in the application bundle.

The application should also provide a setting or first-launch option such as:

**Set as default LaTeX editor**

with a clear explanation of what it does.

Do not merely provide instructions telling the user to manually configure the operating system. The installer/application should perform the registration where the OS permits it.

## "Open With" Support

The application must appear in the operating system's:

**Open With...**

menu for `.tex` files.

It should have a proper application name and icon.

Opening a `.tex` file through:

```text
Right click → Open With → LaTeX Editor
```

must behave exactly like double-clicking a file associated with the application.

## Drag and Drop

The application should also support dragging `.tex` files from the operating system's file manager into the application window.

Dropping a `.tex` file should open it in the appropriate project.

Dropping multiple files should open all supported files in tabs where appropriate.

## Important

This is a **desktop application requirement**, not a browser feature.

The architecture must therefore support:

* Native OS file associations
* Command-line file arguments
* Single-instance detection/IPC
* Native filesystem access
* Opening files from the OS
* Proper application installation

These requirements must be considered during the initial architecture design rather than added as an afterthought.
