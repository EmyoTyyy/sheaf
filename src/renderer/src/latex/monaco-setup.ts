// Every editor feature (find, folding, suggestions, hover, multi-cursor) but
// none of Monaco's bundled languages: LaTeX and BibTeX are defined below, and
// the handful of other file types a LaTeX project holds are pulled in by name.
import 'monaco-editor/esm/vs/editor/editor.all.js'
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution'
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution'
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution'
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'
import 'monaco-editor/esm/vs/basic-languages/ini/ini.contribution'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { registerCompletionProviders } from './completions'

/**
 * Only the base editor worker is needed: no TypeScript, JSON, CSS or HTML
 * language services are loaded.
 */
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker()
}

const LATEX_LANGUAGE: monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.tex',
  brackets: [
    { open: '{', close: '}', token: 'delimiter.curly' },
    { open: '[', close: ']', token: 'delimiter.square' }
  ],

  tokenizer: {
    root: [
      // An escaped character is never the start of a comment or a command.
      [/\\[^a-zA-Z@]/, 'string.escape'],
      [/%.*$/, 'comment'],

      [
        /(\\(?:begin|end))(\s*)(\{)([^}]*)(\})/,
        ['keyword.control', '', 'delimiter.curly', 'type.identifier', 'delimiter.curly']
      ],
      [
        /(\\(?:label|ref|eqref|pageref|autoref|nameref|cref|Cref|vref))(\s*)(\{)([^}]*)(\})/,
        ['keyword.reference', '', 'delimiter.curly', 'variable.reference', 'delimiter.curly']
      ],
      [
        /(\\(?:cite|citep|citet|citeauthor|citeyear|nocite|parencite|textcite|autocite|footcite)\*?)(\s*)(\{)([^}]*)(\})/,
        ['keyword.reference', '', 'delimiter.curly', 'variable.citation', 'delimiter.curly']
      ],
      [
        /(\\(?:usepackage|documentclass|RequirePackage|LoadClass))(\s*)(\[[^\]]*\])?(\s*)(\{)([^}]*)(\})/,
        [
          'keyword.package',
          '',
          'attribute.value',
          '',
          'delimiter.curly',
          'type.package',
          'delimiter.curly'
        ]
      ],
      [
        /(\\(?:input|include|subfile|includegraphics|bibliography|addbibresource|lstinputlisting))(\s*)(\[[^\]]*\])?(\s*)(\{)([^}]*)(\})/,
        [
          'keyword.package',
          '',
          'attribute.value',
          '',
          'delimiter.curly',
          'string.path',
          'delimiter.curly'
        ]
      ],
      [
        /(\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?)/,
        'keyword.section'
      ],
      [/(\\(?:newcommand|renewcommand|providecommand|newenvironment|def|newtheorem))/, 'keyword.definition'],

      [/\$\$/, { token: 'string.math', next: '@mathDisplay' }],
      [/\$/, { token: 'string.math', next: '@mathInline' }],
      [/\\\[/, { token: 'string.math', next: '@mathBracket' }],
      [/\\\(/, { token: 'string.math', next: '@mathParen' }],

      [/\\[a-zA-Z@]+\*?/, 'keyword'],
      [/[{}]/, 'delimiter.curly'],
      [/\[[^\]]*\]/, 'attribute.value'],
      [/&/, 'operator'],
      [/~/, 'operator']
    ],

    mathInline: [
      [/\\[^a-zA-Z@]/, 'string.escape'],
      [/%.*$/, 'comment'],
      [/\$/, { token: 'string.math', next: '@pop' }],
      [/\\[a-zA-Z@]+\*?/, 'keyword.math'],
      [/[{}]/, 'delimiter.curly'],
      [/./, 'string.math']
    ],

    mathDisplay: [
      [/\\[^a-zA-Z@]/, 'string.escape'],
      [/%.*$/, 'comment'],
      [/\$\$/, { token: 'string.math', next: '@pop' }],
      [/\\[a-zA-Z@]+\*?/, 'keyword.math'],
      [/[{}]/, 'delimiter.curly'],
      [/./, 'string.math']
    ],

    mathBracket: [
      [/%.*$/, 'comment'],
      [/\\\]/, { token: 'string.math', next: '@pop' }],
      [/\\[a-zA-Z@]+\*?/, 'keyword.math'],
      [/[{}]/, 'delimiter.curly'],
      [/./, 'string.math']
    ],

    mathParen: [
      [/%.*$/, 'comment'],
      [/\\\)/, { token: 'string.math', next: '@pop' }],
      [/\\[a-zA-Z@]+\*?/, 'keyword.math'],
      [/[{}]/, 'delimiter.curly'],
      [/./, 'string.math']
    ]
  }
}

const BIBTEX_LANGUAGE: monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.bib',
  tokenizer: {
    root: [
      [/%.*$/, 'comment'],
      [/(@[a-zA-Z]+)(\s*)([{(])/, ['keyword', '', 'delimiter.curly']],
      [/^\s*([a-zA-Z][\w-]*)(\s*)(=)/, ['attribute.name', '', 'operator']],
      [/"/, { token: 'string', next: '@stringDouble' }],
      [/\{/, { token: 'delimiter.curly', next: '@braced' }],
      [/[},]/, 'delimiter'],
      [/\d+/, 'number']
    ],
    stringDouble: [
      [/[^"]+/, 'string'],
      [/"/, { token: 'string', next: '@pop' }]
    ],
    braced: [
      [/[^{}]+/, 'string'],
      [/\{/, { token: 'delimiter.curly', next: '@braced' }],
      [/\}/, { token: 'delimiter.curly', next: '@pop' }]
    ]
  }
}

const LATEX_CONFIGURATION: monaco.languages.LanguageConfiguration = {
  comments: { lineComment: '%' },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')']
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '$', close: '$', notIn: ['string', 'comment'] }
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '$', close: '$' }
  ],
  wordPattern: /(\\?[a-zA-Z@]+\*?)|([^\s{}[\]()$\\%,;:]+)/,
  folding: {
    markers: {
      start: /^\s*%\s*#?region\b/,
      end: /^\s*%\s*#?endregion\b/
    }
  },
  onEnterRules: [
    {
      // Pressing Enter between \begin{...} and \end{...} indents the body.
      beforeText: /\\begin\{([^}]*)\}\s*$/,
      afterText: /^\s*\\end\{[^}]*\}/,
      action: { indentAction: monaco.languages.IndentAction.IndentOutdent }
    },
    {
      beforeText: /\\begin\{([^}]*)\}\s*$/,
      action: { indentAction: monaco.languages.IndentAction.Indent }
    },
    {
      beforeText: /^\s*\\item\b.*$/,
      action: { indentAction: monaco.languages.IndentAction.None, appendText: '\\item ' }
    }
  ]
}

/* ------------------------------------------------------------------ */
/* Structure providers                                                 */
/* ------------------------------------------------------------------ */

const SECTION_LEVELS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6
}

const SECTION_RE = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*(?:\[[^\]]*\])?\s*\{(.*?)\}/
const BEGIN_RE = /\\begin\s*\{([^}]*)\}/
const END_RE = /\\end\s*\{([^}]*)\}/

function foldingRanges(model: monaco.editor.ITextModel): monaco.languages.FoldingRange[] {
  const ranges: monaco.languages.FoldingRange[] = []
  const environmentStack: { name: string; line: number }[] = []
  const sectionStack: { level: number; line: number }[] = []
  const lineCount = model.getLineCount()

  for (let line = 1; line <= lineCount; line += 1) {
    const text = model.getLineContent(line)

    const begin = text.match(BEGIN_RE)
    if (begin) environmentStack.push({ name: begin[1], line })

    const end = text.match(END_RE)
    if (end) {
      for (let i = environmentStack.length - 1; i >= 0; i -= 1) {
        if (environmentStack[i].name !== end[1]) continue
        const start = environmentStack.splice(i, 1)[0]
        if (line > start.line) ranges.push({ start: start.line, end: line - 1 })
        break
      }
    }

    const section = text.match(SECTION_RE)
    if (section) {
      const level = SECTION_LEVELS[section[1]] ?? 9
      while (sectionStack.length > 0 && sectionStack[sectionStack.length - 1].level >= level) {
        const previous = sectionStack.pop() as { level: number; line: number }
        if (line - 1 > previous.line) ranges.push({ start: previous.line, end: line - 1 })
      }
      sectionStack.push({ level, line })
    }
  }

  while (sectionStack.length > 0) {
    const previous = sectionStack.pop() as { level: number; line: number }
    if (lineCount > previous.line) ranges.push({ start: previous.line, end: lineCount })
  }

  return ranges
}

/** Section and label outline, used by Monaco and by the Outline sidebar. */
export function documentSymbols(model: monaco.editor.ITextModel): monaco.languages.DocumentSymbol[] {
  const symbols: monaco.languages.DocumentSymbol[] = []
  const stack: { level: number; symbol: monaco.languages.DocumentSymbol }[] = []
  const lineCount = model.getLineCount()

  const push = (level: number, symbol: monaco.languages.DocumentSymbol): void => {
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) {
      parent.symbol.children = parent.symbol.children ?? []
      parent.symbol.children.push(symbol)
    } else {
      symbols.push(symbol)
    }
    stack.push({ level, symbol })
  }

  for (let line = 1; line <= lineCount; line += 1) {
    const text = model.getLineContent(line)
    const section = text.match(SECTION_RE)
    if (!section) continue
    const range = new monaco.Range(line, 1, line, text.length + 1)
    push(SECTION_LEVELS[section[1]] ?? 9, {
      name: section[2] || section[1],
      detail: section[1],
      kind: monaco.languages.SymbolKind.Namespace,
      tags: [],
      range,
      selectionRange: range,
      children: []
    })
  }

  return symbols
}

/* ------------------------------------------------------------------ */
/* Themes                                                              */
/* ------------------------------------------------------------------ */

const DARK_RULES: monaco.editor.ITokenThemeRule[] = [
  { token: 'comment', foreground: '5f6b7a', fontStyle: 'italic' },
  { token: 'keyword', foreground: '82aaff' },
  { token: 'keyword.control', foreground: 'c792ea' },
  { token: 'keyword.section', foreground: 'e5c07b', fontStyle: 'bold' },
  { token: 'keyword.reference', foreground: '89ddff' },
  { token: 'keyword.package', foreground: 'c792ea' },
  { token: 'keyword.definition', foreground: 'f78c6c' },
  { token: 'keyword.math', foreground: '7fd1c0' },
  { token: 'type.identifier', foreground: 'a5d6a7' },
  { token: 'type.package', foreground: 'a5d6a7' },
  { token: 'variable.reference', foreground: 'ffcb6b' },
  { token: 'variable.citation', foreground: 'ffcb6b' },
  { token: 'string.math', foreground: '9ad1b8' },
  { token: 'string.escape', foreground: 'f78c6c' },
  { token: 'string.path', foreground: 'a5d6a7' },
  { token: 'attribute.value', foreground: '8b95a5' },
  { token: 'attribute.name', foreground: '82aaff' },
  { token: 'delimiter.curly', foreground: '8b95a5' },
  { token: 'operator', foreground: 'f78c6c' },
  { token: 'number', foreground: 'f78c6c' },
  { token: 'string', foreground: 'c3e88d' }
]

const LIGHT_RULES: monaco.editor.ITokenThemeRule[] = [
  { token: 'comment', foreground: '7c848f', fontStyle: 'italic' },
  { token: 'keyword', foreground: '2f6fbf' },
  { token: 'keyword.control', foreground: '8250b5' },
  { token: 'keyword.section', foreground: '9a6c12', fontStyle: 'bold' },
  { token: 'keyword.reference', foreground: '0f7490' },
  { token: 'keyword.package', foreground: '8250b5' },
  { token: 'keyword.definition', foreground: 'c1531c' },
  { token: 'keyword.math', foreground: '107a63' },
  { token: 'type.identifier', foreground: '2f7a3f' },
  { token: 'type.package', foreground: '2f7a3f' },
  { token: 'variable.reference', foreground: 'a3651a' },
  { token: 'variable.citation', foreground: 'a3651a' },
  { token: 'string.math', foreground: '17705d' },
  { token: 'string.escape', foreground: 'c1531c' },
  { token: 'string.path', foreground: '2f7a3f' },
  { token: 'attribute.value', foreground: '6b7280' },
  { token: 'attribute.name', foreground: '2f6fbf' },
  { token: 'delimiter.curly', foreground: '6b7280' },
  { token: 'operator', foreground: 'c1531c' },
  { token: 'number', foreground: 'c1531c' },
  { token: 'string', foreground: '2f7a3f' }
]

function defineThemes(): void {
  monaco.editor.defineTheme('sheaf-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: DARK_RULES,
    colors: {
      'editor.background': '#16181c',
      'editor.foreground': '#d6dbe4',
      'editorLineNumber.foreground': '#4b5563',
      'editorLineNumber.activeForeground': '#9aa5b4',
      'editor.lineHighlightBackground': '#1d2128',
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': '#5292d9',
      'editor.selectionBackground': '#2f4a6b',
      'editor.inactiveSelectionBackground': '#25344a',
      'editorIndentGuide.background1': '#242a32',
      'editorIndentGuide.activeBackground1': '#39404a',
      'editorWidget.background': '#1b1e23',
      'editorWidget.border': '#2a2f37',
      'editorSuggestWidget.background': '#1b1e23',
      'editorSuggestWidget.border': '#2a2f37',
      'editorSuggestWidget.selectedBackground': '#2e343d',
      'editorHoverWidget.background': '#1b1e23',
      'editorGutter.background': '#16181c',
      'editorBracketMatch.background': '#2f4a6b55',
      'editorBracketMatch.border': '#5292d9',
      'scrollbarSlider.background': '#39404a80',
      'scrollbarSlider.hoverBackground': '#4b5563aa',
      'editorOverviewRuler.border': '#00000000'
    }
  })

  monaco.editor.defineTheme('sheaf-light', {
    base: 'vs',
    inherit: true,
    rules: LIGHT_RULES,
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#2c3138',
      'editorLineNumber.foreground': '#aab2bd',
      'editorLineNumber.activeForeground': '#4b5563',
      'editor.lineHighlightBackground': '#f2f4f7',
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': '#2f6fbf',
      'editor.selectionBackground': '#cfe0f5',
      'editorWidget.background': '#f7f8fa',
      'editorWidget.border': '#d9dde3',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.border': '#d9dde3',
      'editorGutter.background': '#ffffff',
      'editorBracketMatch.background': '#cfe0f555',
      'editorBracketMatch.border': '#2f6fbf'
    }
  })
}

let initialised = false

export function setupMonaco(): void {
  if (initialised) return
  initialised = true

  monaco.languages.register({ id: 'latex', extensions: ['.tex', '.sty', '.cls', '.ltx'] })
  monaco.languages.setMonarchTokensProvider('latex', LATEX_LANGUAGE)
  monaco.languages.setLanguageConfiguration('latex', LATEX_CONFIGURATION)

  monaco.languages.register({ id: 'bibtex', extensions: ['.bib'] })
  monaco.languages.setMonarchTokensProvider('bibtex', BIBTEX_LANGUAGE)
  monaco.languages.setLanguageConfiguration('bibtex', {
    comments: { lineComment: '%' },
    brackets: [
      ['{', '}'],
      ['(', ')']
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '(', close: ')' },
      { open: '"', close: '"' }
    ]
  })

  monaco.languages.registerFoldingRangeProvider('latex', {
    provideFoldingRanges: (model) => foldingRanges(model)
  })

  monaco.languages.registerDocumentSymbolProvider('latex', {
    provideDocumentSymbols: (model) => documentSymbols(model)
  })

  defineThemes()
  registerCompletionProviders()
}

export { monaco }
