/* MoleculeScene — draws chemistry from a validated SMILES string (Phase 5).
 *
 * The backend has already parsed this SMILES with RDKit, canonicalised it, and
 * computed the formula and mass. Nothing here needs to trust the model: if the
 * string were not a real molecule it would not have reached the client.
 *
 * RDKit's WASM build is ~10 MB, so this whole module is behind a lazy import
 * (see SceneRenderer) and the runtime itself is fetched once, on first use, and
 * shared across every molecule on the page.
 */

import { useEffect, useState } from 'react'
import type { CoachVisualElement, CoachVisualScene } from '../../services/agents'
import './scene.css'

type RDKitModule = {
  get_mol: (smiles: string) => {
    get_svg_with_highlights: (details: string) => string
    get_svg: (width: number, height: number) => string
    delete: () => void
  } | null
}

let runtime: Promise<RDKitModule> | null = null

type RDKitFactory = (options: { locateFile: () => string }) => Promise<RDKitModule>

/** Load the RDKit WASM runtime once per page, not once per molecule.
 *
 *  The published types (`@rdkit/rdkit` → index.d.ts) describe only the molecule
 *  interfaces, not the CommonJS init factory that `dist/RDKit_minimal.js`
 *  actually exports — hence importing the runtime path directly and casting.
 */
function loadRDKit(): Promise<RDKitModule> {
  if (!runtime) {
    runtime = (async () => {
      const [module, wasm] = await Promise.all([
        import('@rdkit/rdkit/dist/RDKit_minimal.js'),
        // Let the bundler fingerprint and serve the .wasm rather than reaching
        // for a CDN — this has to keep working offline and behind a proxy.
        import('@rdkit/rdkit/dist/RDKit_minimal.wasm?url'),
      ])
      const init = ((module as unknown as { default?: RDKitFactory }).default ??
        (module as unknown as RDKitFactory)) as RDKitFactory
      return init({ locateFile: () => (wasm as { default: string }).default })
    })().catch((error) => {
      runtime = null // let a later molecule retry rather than fail forever
      throw error
    })
  }
  return runtime
}

function Molecule({ element }: { element: CoachVisualElement }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const smiles = String(element.smiles ?? '')
  const highlight = (element.highlight as number[] | undefined) ?? []
  const highlightKey = highlight.join(',')

  useEffect(() => {
    let live = true
    loadRDKit()
      .then((rdkit) => {
        const mol = rdkit.get_mol(smiles)
        if (!mol) throw new Error(`RDKit rejected ${smiles}`)
        try {
          // Highlights are atom INDICES resolved server-side from a substructure
          // pattern, so they stay correct however the SMILES was written.
          const details = JSON.stringify({
            width: 520,
            height: 380,
            bondLineWidth: 1.4,
            backgroundColour: [0, 0, 0, 0],
            ...(highlight.length
              ? { atoms: highlight, highlightColour: [0.44, 0.36, 1.0, 0.35] }
              : {}),
          })
          const drawn = mol.get_svg_with_highlights(details)
          if (live) setSvg(drawn)
        } finally {
          mol.delete() // WASM memory is not garbage collected
        }
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
  }, [smiles, highlightKey])

  if (failed) throw new Error('molecule renderer unavailable')

  return (
    <figure className="sp-molecule">
      {svg ? (
        <div
          className="sp-molecule__drawing"
          role="img"
          aria-label={String(element.label ?? element.formula ?? smiles)}
          // RDKit-generated markup from a server-validated structure.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="sp-molecule__loading" role="status">…</div>
      )}
      <figcaption className="sp-molecule__meta">
        {element.label ? <strong dir="auto">{String(element.label)}</strong> : null}
        {element.formula ? <span className="sp-molecule__formula">{formatFormula(String(element.formula))}</span> : null}
        {element.mass ? <span className="sp-molecule__mass">{String(element.mass)} g/mol</span> : null}
      </figcaption>
    </figure>
  )
}

/** C9H8O4 → C₉H₈O₄. Trivial in HTML, genuinely painful in the video renderer. */
function formatFormula(formula: string) {
  const SUB = '₀₁₂₃₄₅₆₇₈₉'
  return formula.replace(/\d/g, (d) => SUB[Number(d)])
}

export function MoleculeScene({ scene }: { scene: CoachVisualScene }) {
  const molecules = scene.elements.filter((element) => element.type === 'molecule')
  return (
    <div className="sp-visual-scene sp-visual-scene--molecule">
      {molecules.map((element, index) => (
        <Molecule key={`${element.smiles}-${index}`} element={element} />
      ))}
    </div>
  )
}

export default MoleculeScene
