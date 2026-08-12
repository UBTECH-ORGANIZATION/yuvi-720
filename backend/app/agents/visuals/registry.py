"""Where a subject plugs into the visual system.

Everything that made this system good at mathematics was written directly into
one module: geometry element types in the validator, geometry repair passes in
the normalizer, geometry vocabulary in the prompt. Adding chemistry that way
meant editing all three, and the prompt grew for every learner regardless of
what they were studying — which is why the contract is already long enough to
crowd out the parts a science question needs.

A domain is instead a small bundle registered here:

- ``contract`` — the prompt fragment describing its vocabulary, sent ONLY when
  the subject is plausibly in play, so the contract stays short.
- ``elements`` — element type names it introduces.
- ``validate`` — turns one untrusted element into a clean one, or None. This is
  the domain's chance to fail closed the way chemistry does with RDKit: an
  element it cannot verify never becomes a picture.
- ``normalize`` — repair passes over the whole element list, its own equivalent
  of the geometry fixes.
- ``subjects`` — the catalogue subjects it serves; ``None`` means always.

Nothing here executes model-authored code. A domain contributes data handlers,
exactly like the rest of the pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

# One untrusted element in, one clean element out (or None to drop it). The
# helpers are the shared validators so a domain does not re-implement bounds.
ElementValidator = Callable[..., Optional[dict]]
# Repair pass over the surviving elements, in place.
Normalizer = Callable[[list[dict]], None]


@dataclass(frozen=True)
class Domain:
    name: str
    contract: str = ""
    elements: frozenset[str] = frozenset()
    validators: dict[str, ElementValidator] = field(default_factory=dict)
    normalizers: tuple[Normalizer, ...] = ()
    subjects: Optional[frozenset[str]] = None

    def serves(self, subject: Optional[str]) -> bool:
        return self.subjects is None or not subject or subject in self.subjects


_DOMAINS: dict[str, Domain] = {}


def register(domain: Domain) -> Domain:
    """Add a domain. Re-registering the same name replaces it (import-order safe)."""
    _DOMAINS[domain.name] = domain
    return domain


def domains(subject: Optional[str] = None) -> list[Domain]:
    """Registered domains that serve this subject, in registration order."""
    return [domain for domain in _DOMAINS.values() if domain.serves(subject)]


def element_types(subject: Optional[str] = None) -> frozenset[str]:
    """Every element type available for a subject."""
    return frozenset().union(*(d.elements for d in domains(subject))) if _DOMAINS else frozenset()


def validator_for(kind: str, subject: Optional[str] = None) -> Optional[ElementValidator]:
    for domain in domains(subject):
        if kind in domain.validators:
            return domain.validators[kind]
    return None


def normalizers(subject: Optional[str] = None) -> list[Normalizer]:
    return [pass_ for domain in domains(subject) for pass_ in domain.normalizers]


def contract_fragments(subject: Optional[str] = None) -> list[str]:
    """Prompt fragments for this subject, so an unrelated vocabulary is not sent.

    A learner working on mass measurement should not be paying tokens for ray
    optics, and more importantly should not have the planner's attention split
    across it.
    """
    return [domain.contract for domain in domains(subject) if domain.contract]
