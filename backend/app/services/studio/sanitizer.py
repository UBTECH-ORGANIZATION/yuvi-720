"""Deterministic safety gate for learner-generated HTML artifacts.

The builder is an LLM driven by free text from a child, so nothing it produces is
trusted. Every artifact is served under a `Content-Security-Policy: sandbox`
header, which already denies it our cookies and our storage even if a learner
opens the URL directly. This module closes what the sandbox does not: exfiltration
of whatever the child types into their own creation, resources pulled from
arbitrary hosts, and frame-escape attempts.

Findings are stable codes, never prose, so routes and tests can assert on them.
A finding blocks publishing; a preview of the learner's own draft is still shown,
because a child debugging their own broken game must be able to see it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from html.parser import HTMLParser
import re
from urllib.parse import urlparse

# Script and stylesheet hosts a creation may pull from. Game and graphics
# libraries are the reason this list is not empty — a browser game without
# Phaser or three.js is a much smaller thing to build.
ALLOWED_RESOURCE_HOSTS = frozenset({
    "cdn.jsdelivr.net",
    "unpkg.com",
    "cdnjs.cloudflare.com",
    "fonts.googleapis.com",
    "fonts.gstatic.com",
})

MAX_BYTES = 512 * 1024

# Tags that may carry a URL, and the attribute that carries it.
_URL_ATTRS = {
    "script": "src",
    "link": "href",
    "img": "src",
    "audio": "src",
    "video": "src",
    "source": "src",
    "track": "src",
    "form": "action",
    "embed": "src",
    "object": "data",
}

_FORBIDDEN_TAGS = frozenset({"iframe", "frame", "frameset", "object", "embed", "base"})

_META_REFRESH = re.compile(r"refresh", re.IGNORECASE)

_JS_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("network_call", re.compile(
        r"\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\s*\(",
        re.IGNORECASE,
    )),
    ("network_call", re.compile(r"\bnavigator\s*\.\s*sendBeacon\b", re.IGNORECASE)),
    # Opaque-origin frames throw on storage access, so a creation that reaches
    # for it is broken as well as unsafe.
    ("storage_access", re.compile(
        r"\b(?:localStorage|sessionStorage|indexedDB|openDatabase)\b", re.IGNORECASE,
    )),
    ("storage_access", re.compile(r"\bdocument\s*\.\s*cookie\b", re.IGNORECASE)),
    ("frame_escape", re.compile(
        r"\b(?:window\s*\.\s*)?(?:parent|top|opener)\s*\.\s*(?:location|postMessage|document)\b",
        re.IGNORECASE,
    )),
    ("frame_escape", re.compile(r"\bwindow\s*\.\s*open\s*\(", re.IGNORECASE)),
)


@dataclass
class Finding:
    code: str
    detail: str


@dataclass
class ScanResult:
    findings: list[Finding] = field(default_factory=list)

    @property
    def safe(self) -> bool:
        return not self.findings

    @property
    def codes(self) -> list[str]:
        """Distinct finding codes, in first-seen order."""
        seen: list[str] = []
        for finding in self.findings:
            if finding.code not in seen:
                seen.append(finding.code)
        return seen


def _host_allowed(url: str) -> bool:
    """True for same-document URLs and for the resource-host allowlist."""
    value = (url or "").strip()
    if not value:
        return True
    lowered = value.lower()
    if lowered.startswith(("javascript:", "vbscript:", "data:text/html")):
        return False
    if lowered.startswith(("#", "/", "./", "../", "?")):
        return True
    if lowered.startswith("data:image/") or lowered.startswith("blob:"):
        return True
    parsed = urlparse(value)
    if not parsed.scheme and not parsed.netloc:
        return True   # a relative filename
    if parsed.scheme not in ("http", "https"):
        return False
    return parsed.hostname is not None and parsed.hostname.lower() in ALLOWED_RESOURCE_HOSTS


class _Scanner(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.findings: list[Finding] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._inspect(tag, attrs)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._inspect(tag, attrs)

    def _inspect(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {name.lower(): (value or "") for name, value in attrs}

        if tag == "meta":
            if _META_REFRESH.search(attributes.get("http-equiv", "")):
                self.findings.append(Finding("meta_refresh", "meta refresh"))
            return

        if tag in _FORBIDDEN_TAGS:
            self.findings.append(Finding("forbidden_tag", tag))
            return

        url_attr = _URL_ATTRS.get(tag)
        if url_attr and not _host_allowed(attributes.get(url_attr, "")):
            code = "external_form" if tag == "form" else "external_resource"
            self.findings.append(Finding(code, f"{tag}[{url_attr}]"))

        for name, value in attributes.items():
            if name.startswith("on"):
                _scan_script(value, self.findings)


def _scan_script(source: str, findings: list[Finding]) -> None:
    for code, pattern in _JS_PATTERNS:
        match = pattern.search(source)
        if match:
            findings.append(Finding(code, match.group(0).strip()))


def scan(html: str) -> ScanResult:
    """Inspect one artifact and return every reason it must not be published."""
    result = ScanResult()

    if not (html or "").strip():
        result.findings.append(Finding("empty_document", "no content"))
        return result

    if len(html.encode("utf-8")) > MAX_BYTES:
        result.findings.append(Finding("too_large", f"{MAX_BYTES} bytes"))
        return result

    scanner = _Scanner()
    try:
        scanner.feed(html)
        scanner.close()
    except Exception:
        # A document this malformed is not something to hand to a browser.
        result.findings.append(Finding("unparsable", "malformed html"))
        return result

    result.findings.extend(scanner.findings)
    _scan_script(html, result.findings)
    return result


def content_security_policy() -> str:
    """The header the artifact is served under.

    `sandbox` without `allow-same-origin` gives the document an opaque origin, so
    it cannot reach our cookies or storage even on our own host. `connect-src
    'none'` is the part that actually stops exfiltration — the scanner is the
    publish gate, this is the runtime one.
    """
    hosts = " ".join(f"https://{host}" for host in sorted(ALLOWED_RESOURCE_HOSTS))
    return "; ".join([
        "sandbox allow-scripts allow-pointer-lock",
        "default-src 'none'",
        f"script-src 'unsafe-inline' 'unsafe-eval' {hosts}",
        f"style-src 'unsafe-inline' {hosts}",
        "img-src data: blob:",
        f"font-src data: {hosts}",
        "media-src data: blob:",
        "connect-src 'none'",
        "frame-src 'none'",
        "form-action 'none'",
        "base-uri 'none'",
    ])


def assert_publishable(html: str) -> list[str]:
    """Return the blocking finding codes; empty means the artifact may publish."""
    return scan(html).codes
