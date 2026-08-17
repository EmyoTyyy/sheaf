import type { TemplateId, TemplateInfo } from '@shared/types'

export const TEMPLATES: TemplateInfo[] = [
  {
    id: 'blank',
    name: 'Blank Document',
    description: 'A minimal document class with nothing else.'
  },
  {
    id: 'article',
    name: 'Article',
    description: 'Single-file article with sections, maths, a figure and a table.'
  },
  {
    id: 'report',
    name: 'Report',
    description: 'Chapter-based report with a title page and table of contents.'
  },
  {
    id: 'book',
    name: 'Book',
    description: 'Front matter, chapters in separate files, and an index-ready layout.'
  },
  {
    id: 'thesis',
    name: 'Thesis',
    description: 'Multi-file thesis with chapters, images and a BibTeX bibliography.'
  },
  {
    id: 'beamer',
    name: 'Presentation (Beamer)',
    description: 'Slide deck with frames, columns and a table of contents.'
  },
  {
    id: 'letter',
    name: 'Letter',
    description: 'Formal letter using the standard letter class.'
  }
]

const PREAMBLE = String.raw`\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{amsmath}
\usepackage{amssymb}
\usepackage{graphicx}
\usepackage[hidelinks]{hyperref}`

function blank(title: string): Record<string, string> {
  return {
    'main.tex': String.raw`\documentclass{article}

\begin{document}

${title}

\end{document}
`
  }
}

function article(title: string): Record<string, string> {
  return {
    'main.tex': String.raw`\documentclass[11pt,a4paper]{article}

${PREAMBLE}

\title{${title}}
\author{Your Name}
\date{\today}

\begin{document}

\maketitle

\begin{abstract}
    A short summary of the document goes here.
\end{abstract}

\section{Introduction}
\label{sec:introduction}

This document was created with Sheaf. Edit it, press \texttt{Ctrl+Enter} to
compile, and the PDF on the right refreshes automatically.

\section{Mathematics}
\label{sec:mathematics}

Inline maths such as $e^{i\pi} + 1 = 0$ sits in the middle of a sentence, while
displayed equations are numbered and can be referenced:

\begin{equation}
    \label{eq:gaussian}
    \int_{-\infty}^{\infty} e^{-x^{2}} \, \mathrm{d}x = \sqrt{\pi}.
\end{equation}

Equation~\eqref{eq:gaussian} is referenced from Section~\ref{sec:mathematics}.

\section{Lists}

\begin{itemize}
    \item A bulleted item.
    \item Another one.
\end{itemize}

\begin{enumerate}
    \item A numbered item.
    \item Another one.
\end{enumerate}

\section{Tables}

\begin{table}[ht]
    \centering
    \begin{tabular}{lrr}
        \hline
        Method & Accuracy & Time (s) \\
        \hline
        Baseline & 0.81 & 12.4 \\
        Proposed & 0.94 & 15.1 \\
        \hline
    \end{tabular}
    \caption{A simple table.}
    \label{tab:results}
\end{table}

\section{Conclusion}

Table~\ref{tab:results} closes the document.

\end{document}
`
  }
}

function report(title: string): Record<string, string> {
  return {
    'main.tex': String.raw`\documentclass[11pt,a4paper]{report}

${PREAMBLE}

\title{${title}}
\author{Your Name}
\date{\today}

\begin{document}

\maketitle
\tableofcontents

\chapter{Introduction}
\label{ch:introduction}

The opening chapter of the report.

\section{Background}

Some background material.

\chapter{Method}
\label{ch:method}

What was done, and how.

\chapter{Results}
\label{ch:results}

What came out of it.

\chapter{Conclusion}

Closing remarks, referring back to Chapter~\ref{ch:method}.

\end{document}
`
  }
}

function book(title: string): Record<string, string> {
  return {
    'main.tex': String.raw`\documentclass[11pt,a4paper,twoside]{book}

${PREAMBLE}

\title{${title}}
\author{Your Name}
\date{\today}

\begin{document}

\frontmatter
\maketitle
\tableofcontents

\mainmatter

\input{chapters/introduction}
\input{chapters/first-chapter}

\backmatter

\end{document}
`,
    'chapters/introduction.tex': String.raw`\chapter{Introduction}
\label{ch:introduction}

The introduction lives in its own file. Sheaf follows
\verb|\input| and \verb|\include| so labels, citations and
diagnostics work across every file in the project.
`,
    'chapters/first-chapter.tex': String.raw`\chapter{The First Chapter}
\label{ch:first}

Content of the first chapter, which can refer back to
Chapter~\ref{ch:introduction}.

\section{A Section}

Sections nest inside chapters in the book class.
`
  }
}

function thesis(title: string): Record<string, string> {
  return {
    'main.tex': String.raw`\documentclass[12pt,a4paper]{report}

${PREAMBLE}
\usepackage[margin=2.5cm]{geometry}
\usepackage{setspace}
\onehalfspacing

\title{${title}}
\author{Your Name}
\date{\today}

\begin{document}

\begin{titlepage}
    \centering
    \vspace*{4cm}
    {\Huge\bfseries ${title}\par}
    \vspace{1.5cm}
    {\Large Your Name\par}
    \vspace{1cm}
    {\large A thesis submitted for the degree of\par}
    {\large Doctor of Philosophy\par}
    \vfill
    {\large \today\par}
\end{titlepage}

\tableofcontents
\listoffigures

\input{chapters/introduction}
\input{chapters/methodology}
\input{chapters/conclusion}

\bibliographystyle{plain}
\bibliography{bibliography}

\end{document}
`,
    'chapters/introduction.tex': String.raw`\chapter{Introduction}
\label{ch:introduction}

This chapter motivates the work. Citations resolve against every
\texttt{.bib} file in the project, for example~\cite{knuth1984texbook}.

\section{Motivation}

Typing a backslash in the editor offers command completions; typing
\verb|\cite{| lists the keys found in the bibliography.
`,
    'chapters/methodology.tex': String.raw`\chapter{Methodology}
\label{ch:methodology}

Figures are referenced by label, and Sheaf reports a warning when a
label does not exist.

\begin{figure}[ht]
    \centering
    \includegraphics[width=0.6\textwidth]{images/example-diagram.pdf}
    \caption{Replace this with your own figure.}
    \label{fig:architecture}
\end{figure}

Figure~\ref{fig:architecture} illustrates the approach described
in Chapter~\ref{ch:introduction}. See also~\cite{lamport1994latex}.
`,
    'chapters/conclusion.tex': String.raw`\chapter{Conclusion}
\label{ch:conclusion}

Summarise the contributions and outline future work.
`,
    'bibliography.bib': String.raw`@book{knuth1984texbook,
  author    = {Knuth, Donald E.},
  title     = {The {\TeX}book},
  publisher = {Addison-Wesley},
  year      = {1984},
  address   = {Reading, Massachusetts}
}

@book{lamport1994latex,
  author    = {Lamport, Leslie},
  title     = {{\LaTeX}: A Document Preparation System},
  publisher = {Addison-Wesley},
  year      = {1994},
  edition   = {2nd}
}
`,
    'images/.gitkeep': ''
  }
}

function beamer(title: string): Record<string, string> {
  return {
    'main.tex': String.raw`\documentclass[aspectratio=169]{beamer}

\usetheme{Madrid}
\usecolortheme{seahorse}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{amsmath}
\usepackage{graphicx}

\title{${title}}
\author{Your Name}
\institute{Your Institution}
\date{\today}

\begin{document}

\begin{frame}
    \titlepage
\end{frame}

\begin{frame}{Outline}
    \tableofcontents
\end{frame}

\section{Introduction}

\begin{frame}{Introduction}
    \begin{itemize}
        \item First point.
        \item Second point.
        \item<2-> This one appears on the second click.
    \end{itemize}
\end{frame}

\section{Details}

\begin{frame}{Two Columns}
    \begin{columns}
        \begin{column}{0.5\textwidth}
            Text on the left-hand side.
        \end{column}
        \begin{column}{0.5\textwidth}
            \begin{block}{A block}
                Highlighted content.
            \end{block}
        \end{column}
    \end{columns}
\end{frame}

\section{Conclusion}

\begin{frame}{Conclusion}
    \begin{equation*}
        E = mc^{2}
    \end{equation*}
    \centering
    Thank you.
\end{frame}

\end{document}
`
  }
}

function letter(title: string): Record<string, string> {
  return {
    'main.tex': String.raw`\documentclass[11pt,a4paper]{letter}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}

\signature{Your Name}
\address{Your Street \\ Your City \\ Your Country}

\begin{document}

\begin{letter}{Recipient Name \\ Recipient Street \\ Recipient City}

\opening{Dear Sir or Madam,}

${title}

The body of the letter goes here. Add as many paragraphs as needed;
they are separated by a blank line.

\closing{Yours faithfully,}

\encl{Enclosures, if any}

\end{letter}

\end{document}
`
  }
}

const BUILDERS: Record<TemplateId, (title: string) => Record<string, string>> = {
  blank,
  article,
  report,
  book,
  thesis,
  beamer,
  letter
}

/** Escapes characters that would break a LaTeX title. */
function escapeLatex(value: string): string {
  return value.replace(/([&%$#_{}])/g, '\\$1').replace(/~/g, '\\textasciitilde{}')
}

export function buildTemplateFiles(id: TemplateId, projectName: string): Record<string, string> {
  const builder = BUILDERS[id] ?? BUILDERS.article
  return builder(escapeLatex(projectName))
}
