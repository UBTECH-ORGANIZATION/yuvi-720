/* The assistant's explainability surface.
 *
 * Every tool that ran, and what it returned: data, nothing, or an error. This
 * is what makes an assistant answer checkable rather than merely fluent — a
 * teacher can see the answer stands on three real reads, or on none.
 *
 * The ungrounded warning is deliberately loud. An answer with an empty trace is
 * the exact failure mode this phase exists to prevent, and if one ever reaches
 * a teacher it must not look like every other answer.
 */

import { Icon } from '../../../components/primitives/Icon'
import { useI18n } from '../../../i18n/I18nProvider'
import type { ToolTraceEntry } from '../../../services/teacherAssistant'

/* Only names that exist in `ICON_PATHS` — `Icon` accepts any string and renders
   an empty glyph for an unknown one, so a typo here would be invisible. */
const STATUS_ICON = {
  ok: 'check',
  empty: 'help',
  error: 'alert',
} as const

export function ToolTrace({ tools, grounded }: { tools: ToolTraceEntry[]; grounded: boolean }) {
  const { t } = useI18n()

  if (!tools.length) {
    return (
      <p className="tch-trace tch-trace--none">
        <Icon name="alert" size={14} aria-hidden />
        {grounded ? t('tch.assistant.trace.none') : t('tch.assistant.ungrounded')}
      </p>
    )
  }

  return (
    <details className="tch-trace">
      <summary>
        <Icon name="pulse" size={14} aria-hidden />
        {t('tch.assistant.trace.title')}
        <span className="tch-trace__count">{tools.length}</span>
      </summary>
      <ul>
        {tools.map((tool, index) => (
          <li key={`${tool.name}-${index}`} className={`tch-trace__row is-${tool.status}`}>
            <Icon name={STATUS_ICON[tool.status] ?? 'help'} size={13} aria-hidden />
            <code>{tool.name}</code>
            <span className="tch-trace__status">
              {t(`tch.assistant.trace.${tool.status}`)}
            </span>
            {/* The machine reason, verbatim. `learner_has_no_activity` tells a
                teacher more about why an answer is empty than any paraphrase. */}
            {tool.reason ? <small className="tch-trace__reason">{tool.reason}</small> : null}
          </li>
        ))}
      </ul>
    </details>
  )
}
