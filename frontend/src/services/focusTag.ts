/** The coach's hidden focus tag (`⟦o3⟧`, backend app/agents/focus_tag.py)
 *  is stripped on the server before delivery; this is the second net, so a
 *  tag can never render — including a half-streamed `⟦o` at the end of a
 *  chunk that is still arriving. */
// ⟦ ⟧ and 【 】 never occur in a reply's prose: any short token inside them is
// a tag attempt (the model sometimes writes ⟦השאלה⟧ or ⟦table⟧). `[[ ]]` can
// be ordinary text, so it counts only around an alias.
const FOCUS_TAG = /⟦[^⟧\n]{0,24}⟧|【[^】\n]{0,24}】|\[\[\s*(?:o\d{1,2}|q|opts|none|-)\s*\]\]/gi
const FOCUS_TAG_PARTIAL = /(⟦|【)[^⟧】\n]{0,24}$/

export function stripFocusTags(text: string, streaming = false): string {
  const stripped = text.replace(FOCUS_TAG, '')
  return streaming ? stripped.replace(FOCUS_TAG_PARTIAL, '') : stripped
}
