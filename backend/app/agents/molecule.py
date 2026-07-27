"""Chemistry element validation for Coach scenes (Phase 5).

Chemistry does not have the problem math has. The planner never computes
coordinates: it emits a SMILES string and the renderer derives every bond angle,
ring geometry and label position. So there is no placement solver here.

What chemistry gains instead is something math never had — a *decidable*
correctness gate. RDKit either parses a string into a molecule or it does not.
An unparseable SMILES is not a molecule, so it never becomes a visual, and the
formula and mass shown to the learner are computed rather than asserted by the
model.

FAIL CLOSED. If RDKit is unavailable the validator returns None and the element
is dropped. The alternative — passing the string through unvalidated — would
silently remove the guarantee in exactly the environment where nobody notices,
and Yuvi would start showing model-invented structures as fact. Losing chemistry
visuals is recoverable; showing a fabricated molecule to a learner is not.
"""

from __future__ import annotations

from typing import Optional


MAX_SMILES_LENGTH = 200
# A molecule far bigger than school chemistry needs is either a mistake or an
# attempt to make the renderer do a lot of work.
MAX_HEAVY_ATOMS = 80

_rdkit_missing_logged = False


def _chem():
    """Import RDKit lazily; None when unavailable (see FAIL CLOSED above)."""
    global _rdkit_missing_logged
    try:
        from rdkit import Chem
        from rdkit import RDLogger

        # RDKit prints parse failures to stderr; we handle them as return values.
        RDLogger.DisableLog("rdApp.*")
        return Chem
    except ImportError:
        if not _rdkit_missing_logged:
            _rdkit_missing_logged = True
            print(
                "⚠️ RDKit is not installed — molecule visuals are disabled. "
                "Install `rdkit` on the backend to enable them."
            )
        return None


def validate_molecule(
    smiles: object,
    highlight: object = None,
) -> Optional[dict]:
    """Turn an untrusted SMILES string into a verified molecule payload.

    Returns ``None`` for anything that is not a real, reasonably sized molecule.
    On success the payload carries the CANONICAL smiles (so the same molecule
    written two ways caches and compares as one), plus a computed formula and
    mass — values the model does not get to assert.
    """
    if not isinstance(smiles, str):
        return None
    text = smiles.strip()
    if not text or len(text) > MAX_SMILES_LENGTH:
        return None

    Chem = _chem()
    if Chem is None:
        return None

    mol = Chem.MolFromSmiles(text)
    if mol is None:
        return None
    if mol.GetNumHeavyAtoms() == 0 or mol.GetNumHeavyAtoms() > MAX_HEAVY_ATOMS:
        return None

    from rdkit.Chem import Descriptors, rdMolDescriptors

    payload = {
        "smiles": Chem.MolToSmiles(mol),
        "formula": rdMolDescriptors.CalcMolFormula(mol),
        "mass": round(Descriptors.MolWt(mol), 2),
    }

    atoms = _highlight_atoms(Chem, mol, highlight)
    if atoms:
        payload["highlight"] = atoms
    return payload


def _highlight_atoms(Chem, mol, highlight: object) -> list[int]:
    """Resolve a substructure pattern to atom indices.

    Addressing a functional group by SMARTS rather than by index is what makes
    "light up the carboxyl" survive the planner writing the molecule a different
    way round. A pattern that does not compile, or does not match, simply
    highlights nothing — it never invalidates the molecule.
    """
    if not isinstance(highlight, str) or not highlight.strip():
        return []
    pattern = Chem.MolFromSmarts(highlight.strip()) or Chem.MolFromSmiles(highlight.strip())
    if pattern is None:
        return []
    matches = mol.GetSubstructMatches(pattern)
    return sorted({index for match in matches for index in match})
