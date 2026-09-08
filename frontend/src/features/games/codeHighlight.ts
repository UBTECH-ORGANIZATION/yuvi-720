/* A small regex tokenizer per line for the html/css/js a game is made of.
 * Enough for colours; a real parser would cost 300KB for the same effect.
 */

type Kind = 'tag' | 'attr' | 'str' | 'cmt' | 'kw' | 'num' | 'fn' | 'punct' | 'txt'
export type Token = [Kind, string]
type Mode = 'html' | 'css' | 'js'

const JS_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case',
  'break', 'continue', 'new', 'class', 'extends', 'super', 'this', 'import', 'export', 'from', 'default',
  'try', 'catch', 'finally', 'throw', 'async', 'await', 'typeof', 'instanceof', 'in', 'of', 'true',
  'false', 'null', 'undefined', 'static', 'get', 'set', 'yield', 'delete', 'void',
])

const JS_TOKEN = /(\/\/.*$)|(\/\*[\s\S]*?\*\/|\/\*.*$)|(`(?:\\.|[^`\\])*`?|"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)|([{}()[\];,.=+\-*/%<>!&|?:^~])/g
const CSS_TOKEN = /(\/\*.*?\*\/|\/\*.*$)|("(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?)|(#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|vh|vw|%|s|ms|deg)?\b)|([a-zA-Z-]+)(?=\s*:)|([.#]?[A-Za-z_-][\w-]*)|([{}();:,>+~*])/g
const HTML_TOKEN = /(<!--.*?-->|<!--.*$)|(<\/?[A-Za-z][\w-]*|\/?>|<!DOCTYPE\b)|([A-Za-z-]+)(?==)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?)|([^<"'\s]+|\s+)/g

function tokenizeJs(line: string): Token[] {
  const out: Token[] = []
  let last = 0
  for (const m of line.matchAll(JS_TOKEN)) {
    if (m.index! > last) out.push(['txt', line.slice(last, m.index)])
    if (m[1] || m[2]) out.push(['cmt', m[0]])
    else if (m[3]) out.push(['str', m[0]])
    else if (m[4]) out.push(['num', m[0]])
    else if (m[5]) out.push([JS_KEYWORDS.has(m[5]) ? 'kw' : 'fn', m[0]])
    else if (m[6]) out.push([JS_KEYWORDS.has(m[6]) ? 'kw' : 'txt', m[0]])
    else out.push(['punct', m[0]])
    last = m.index! + m[0].length
  }
  if (last < line.length) out.push(['txt', line.slice(last)])
  return out
}

function tokenizeCss(line: string): Token[] {
  const out: Token[] = []
  let last = 0
  for (const m of line.matchAll(CSS_TOKEN)) {
    if (m.index! > last) out.push(['txt', line.slice(last, m.index)])
    if (m[1]) out.push(['cmt', m[0]])
    else if (m[2]) out.push(['str', m[0]])
    else if (m[3]) out.push(['num', m[0]])
    else if (m[4]) out.push(['attr', m[0]])
    else if (m[5]) out.push([m[0].startsWith('.') || m[0].startsWith('#') ? 'tag' : 'txt', m[0]])
    else out.push(['punct', m[0]])
    last = m.index! + m[0].length
  }
  if (last < line.length) out.push(['txt', line.slice(last)])
  return out
}

function tokenizeHtml(line: string): Token[] {
  const out: Token[] = []
  for (const m of line.matchAll(HTML_TOKEN)) {
    if (m[1]) out.push(['cmt', m[0]])
    else if (m[2]) out.push(['tag', m[0]])
    else if (m[3]) out.push(['attr', m[0]])
    else if (m[4]) out.push(['str', m[0]])
    else out.push(['txt', m[0]])
  }
  return out
}

/** Which language the next line is in, from the html tags seen so far. */
function nextMode(mode: Mode, line: string): Mode {
  if (mode === 'html') {
    if (/<script\b[^>]*>(?!.*<\/script>)/i.test(line)) return 'js'
    if (/<style\b[^>]*>(?!.*<\/style>)/i.test(line)) return 'css'
    return 'html'
  }
  if (mode === 'js' && /<\/script>/i.test(line)) return 'html'
  if (mode === 'css' && /<\/style>/i.test(line)) return 'html'
  return mode
}

function tokenizeLine(mode: Mode, line: string): Token[] {
  if (mode === 'js') return /<\/script>/i.test(line) ? tokenizeHtml(line) : tokenizeJs(line)
  if (mode === 'css') return /<\/style>/i.test(line) ? tokenizeHtml(line) : tokenizeCss(line)
  return tokenizeHtml(line)
}

export function highlightLines(code: string): Token[][] {
  const rows: Token[][] = []
  let mode: Mode = 'html'
  for (const line of code.split('\n')) {
    rows.push(tokenizeLine(mode, line))
    mode = nextMode(mode, line)
  }
  return rows
}

