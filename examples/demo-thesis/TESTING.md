# Testing Sheaf with this project

Open this folder in Sheaf (**Open folder** on the dashboard, then pick
`examples/demo-thesis`) and work down the list. Everything here should work on
a machine with TeX Live installed; nothing needs a network connection.

## 1. A clean build

1. Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd>.
2. The PDF appears on the right: title page, table of contents, list of
   figures, four chapters, a figure, a table and a bibliography.
3. The status bar shows how long the build took. **Raw Log** lists each pass —
   `pdflatex`, then `bibtex`, then `pdflatex` again twice, because the
   citations and the list of figures need extra passes to settle.
4. **Problems** should show one *Info* item: `mittelbach2004companion` is in
   the bibliography but never cited. That is deliberate.

## 2. Errors that point at the right line

Open `chapters/results.tex` and add a line inside the `align` block:

```latex
\nosuchcommand{x}
```

Compile. The Problems panel should show **Undefined control sequence** with
`chapters/results.tex` and the line number. Click it — the file opens and the
cursor lands on that line, which is also underlined in the editor. Undo, and
compile again to get back to a clean build.

For a missing package, add `\usepackage{thispackagedoesnotexist}` to
`main.tex`. The error should come with an explanation that names the package
and the `tlmgr install` command.

## 3. Cross-references and citations before you compile

These are found by static analysis, so they appear without building anything:

* In `chapters/conclusion.tex`, change `\ref{ch:results}` to
  `\ref{ch:nowhere}`. Within a moment, Problems reports a reference with no
  matching `\label`.
* Change a `\cite{knuth1984texbook}` key to something misspelled. Problems
  reports a citation that is in no `.bib` file.

Undo both.

## 4. Completion

In any chapter, type:

* `\ref{` — offers every label in the project, with the section it sits under.
* `\cite{` — offers the three bibliography keys, with author and year.
* `\begin{` — offers environments; picking one writes the matching `\end`.
* `\end{` — offers whichever environment is still open above the cursor.
* `\vect` — offered because `main.tex` defines it with `\newcommand`.
* `\includegraphics{` — offers the files under `images/`.

Hovering over a `\cite` key shows the full bibliography entry; hovering over a
`\ref` shows where the label is defined.

## 5. Source and PDF in step

* Put the cursor on a paragraph in `chapters/results.tex` and press
  <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>J</kbd>. The PDF scrolls to that spot and
  flashes a highlight.
* Click any text in the PDF. The matching source line opens and is highlighted.

Both need one successful build first, because they read the SyncTeX file.

## 6. Files

* Drag `images/convergence.png` from the explorer into the editor: a complete
  `figure` block is inserted, with the caption and label derived from the file
  name. The template is editable under **Settings → Project**.
* Right-click a file for rename, delete, "Set as main document" and
  "Show in file manager".
* Drag a file onto a folder in the explorer to move it.
* Drop a file from your desktop file manager onto the explorer to import it.

## 7. Everything else worth a minute

| Try | Expect |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>P</kbd> | Quick open, fuzzy matching on path |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> | Project search; click a result to jump |
| <kbd>Ctrl</kbd>+<kbd>B</kbd> / <kbd>Ctrl</kbd>+<kbd>J</kbd> | Hide the sidebar / bottom panel |
| Outline tab in the sidebar | Chapters and sections of the open file |
| **Auto** checkbox in the toolbar | Compiles about a second after you stop typing |
| Terminal tab | Run `latexmk -pdf main.tex`; output streams back |
| Git tab | Offers to `git init` if this is not a repository yet |
| Settings → Project | Shows the exact build command that will run |
| Compiler dropdown | Switch to `lualatex` or `latexmk` and rebuild |

## 8. Where the output goes

Build artefacts land in `.sheaf/build/` and never next to your sources. The
only other thing Sheaf writes is `.sheaf/settings.json`, which holds this
project's compiler choice and main document. Delete the `.sheaf` folder and
nothing of yours is lost.
