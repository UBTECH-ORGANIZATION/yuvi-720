import { useMemo } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { layoutDiagram, type DiagramSpec } from './diagram.ts'
import './rich-text.css'

/* Draws a validated diagram spec. Nothing here comes from the model except
   plain label text inside `<text>` — no markup, no `dangerouslySetInnerHTML`,
   no measured reflow. Every coordinate was computed in `diagram.ts`.

   Labels are SVG text rather than `foreignObject`: the boxes are sized by the
   layout, and each label carries its own direction so a Hebrew or Arabic
   string reads correctly inside an otherwise English diagram. */
export function DiagramView({ spec }: { spec: DiagramSpec }) {
  const { direction } = useI18n()
  const layout = useMemo(() => layoutDiagram(spec, direction === 'rtl'), [spec, direction])

  return (
    <div className="sp-md-diagram">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        role="img"
        aria-label={layout.description}
        focusable="false"
      >
        {layout.title && (
          <text
            className="sp-md-diagram__title"
            x={layout.width / 2}
            y={20}
            textAnchor="middle"
            direction={layout.titleRtl ? 'rtl' : 'ltr'}
          >
            {layout.title}
          </text>
        )}
        {layout.edges.map((edge, index) => (
          <g className="sp-md-diagram__edge" key={`${edge.from}-${edge.to}-${index}`}>
            <path d={edge.d} />
            <polygon points={edge.head} />
            {edge.label && (
              <>
                <rect
                  className="sp-md-diagram__labelbg"
                  x={edge.label.x - edge.label.w / 2}
                  y={edge.label.y - edge.label.h / 2}
                  width={edge.label.w}
                  height={edge.label.h}
                  rx={6}
                />
                <text
                  className="sp-md-diagram__label"
                  x={edge.label.x}
                  y={edge.label.y + 4}
                  textAnchor="middle"
                  direction={edge.label.rtl ? 'rtl' : 'ltr'}
                >
                  {edge.label.text}
                </text>
              </>
            )}
          </g>
        ))}
        {layout.nodes.map((node) => (
          <g className="sp-md-diagram__node" key={node.id}>
            <rect x={node.x} y={node.y} width={node.w} height={node.h} rx={10} />
            <text
              x={node.x + node.w / 2}
              y={node.y + node.h / 2 - (node.lines.length - 1) * 8.5 + 5}
              textAnchor="middle"
              direction={node.rtl ? 'rtl' : 'ltr'}
            >
              {node.lines.map((line, index) => (
                <tspan key={index} x={node.x + node.w / 2} dy={index ? 17 : 0}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
