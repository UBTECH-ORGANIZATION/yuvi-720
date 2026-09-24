/** The coach's hidden focus tag (`⟦o3⟧`, backend app/agents/focus_tag.py)
 *  is stripped on the server before delivery; this is the second net, so a
 *  tag can never render — including a half-streamed `⟦o` at the end of a
 *  chunk that is still arriving. */
const FOCUS_TAG = /(⟦|\[\[|【)\s*(o\d{1,2}|q|opts|none|-)\s*(⟧|\]\]|】)/gi
const FOCUS_TAG_PARTIAL = /(⟦|【)\s*[\w-]{0,5}$/

export function stripFocusTags(text: string, streaming = false): string {
  const stripped = text.replace(FOCUS_TAG, '')
  return streaming ? stripped.replace(FOCUS_TAG_PARTIAL, '') : stripped
}
