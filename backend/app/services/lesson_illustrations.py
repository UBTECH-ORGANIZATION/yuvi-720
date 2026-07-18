"""Curated, pre-built animated lesson illustrations (no model generation).

Spark ships a small library of hand-authored, mathematically and scientifically
faithful animated SVG diagrams. The dashboard and catalog read from this library
only — there is **no runtime model call and no generation pipeline**. Lessons that
do not map to a specific diagram fall back to a friendly default ("lomda")
illustration so the hero always shows a topic visual.

Each asset is served inline as an inert ``<img>`` SVG. Motion-reduced variants are
derived automatically by stripping the SMIL animation elements.
"""

from __future__ import annotations

import re
from typing import Any, Optional

SVG_NS = "http://www.w3.org/2000/svg"

_SUBJECT_LABELS = {
    "math": {"he": "מתמטיקה", "ar": "الرياضيات", "en": "mathematics"},
    "science": {"he": "מדע", "ar": "العلوم", "en": "science"},
    "biology": {"he": "ביולוגיה", "ar": "الأحياء", "en": "biology"},
    "physics": {"he": "פיזיקה", "ar": "الفيزياء", "en": "physics"},
    "astronomy": {"he": "אסטרונומיה", "ar": "علم الفلك", "en": "astronomy"},
}

# ─────────────────────────────────────────────────────────────────────────────
# Hand-authored animated SVG sources. viewBox 0 0 960 540, transparent canvas.
# Palette: indigo #5B5CE2 · purple #6F5BFF/#9F7AFE · cyan #16B8D4/#4CC9F0 ·
#          green #22B573 · pink #F05BB5 · amber #F5A623.
# ─────────────────────────────────────────────────────────────────────────────

_ANGLES_TYPES = r'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540">
<defs><radialGradient id="glow" cx="0.5" cy="0.6" r="0.62"><stop offset="0" stop-color="#EEF0FF"/><stop offset="1" stop-color="#EEF0FF" stop-opacity="0"/></radialGradient></defs>
<ellipse cx="480" cy="310" rx="400" ry="245" fill="url(#glow)"/>
<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -6;0 0" keyTimes="0;0.5;1" dur="6s" repeatCount="indefinite"/>
<path d="M195 405 A285 285 0 0 1 765 405" fill="#F3F5FF" stroke="#C2CBF2" stroke-width="4"/>
<path d="M250 405 A230 230 0 0 1 710 405" fill="none" stroke="#D6DCF7" stroke-width="3"/>
<line x1="175" y1="405" x2="785" y2="405" stroke="#5B5CE2" stroke-width="9" stroke-linecap="round"/>
<g transform="rotate(-36 480 405)"><animateTransform attributeName="transform" type="rotate" values="-36 480 405;-30 480 405;-36 480 405" keyTimes="0;0.5;1" dur="6s" repeatCount="indefinite"/><line x1="480" y1="405" x2="742" y2="405" stroke="#16B8D4" stroke-width="10" stroke-linecap="round"/><circle cx="742" cy="405" r="9" fill="#16B8D4"/></g>
<g transform="rotate(-90 480 405)"><animateTransform attributeName="transform" type="rotate" values="-90 480 405;-84 480 405;-90 480 405" keyTimes="0;0.5;1" dur="7s" repeatCount="indefinite"/><line x1="480" y1="405" x2="742" y2="405" stroke="#22B573" stroke-width="10" stroke-linecap="round"/><circle cx="742" cy="405" r="9" fill="#22B573"/></g>
<g transform="rotate(-128 480 405)"><animateTransform attributeName="transform" type="rotate" values="-128 480 405;-134 480 405;-128 480 405" keyTimes="0;0.5;1" dur="8s" repeatCount="indefinite"/><line x1="480" y1="405" x2="742" y2="405" stroke="#F05BB5" stroke-width="10" stroke-linecap="round"/><circle cx="742" cy="405" r="9" fill="#F05BB5"/></g>
<circle cx="480" cy="405" r="13" fill="#FFFFFF" stroke="#5B5CE2" stroke-width="6"/>
</g></svg>'''

_ANGLES_VERTICAL = r'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540">
<defs><radialGradient id="glow" cx="0.5" cy="0.5" r="0.6"><stop offset="0" stop-color="#EEF0FF"/><stop offset="1" stop-color="#EEF0FF" stop-opacity="0"/></radialGradient></defs>
<ellipse cx="480" cy="270" rx="380" ry="230" fill="url(#glow)"/>
<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" keyTimes="0;0.5;1" dur="6s" repeatCount="indefinite"/>
<line x1="230" y1="180" x2="730" y2="360" stroke="#5B5CE2" stroke-width="10" stroke-linecap="round"/>
<line x1="230" y1="360" x2="730" y2="180" stroke="#6F5BFF" stroke-width="10" stroke-linecap="round"/>
<path d="M427.3 251 A56 56 0 0 1 532.7 251" fill="none" stroke="#F05BB5" stroke-width="9" stroke-linecap="round"><animate attributeName="opacity" values="0.45;1;0.45" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite"/></path>
<path d="M532.7 289 A56 56 0 0 1 427.3 289" fill="none" stroke="#F05BB5" stroke-width="9" stroke-linecap="round"><animate attributeName="opacity" values="0.45;1;0.45" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite"/></path>
<path d="M438.6 284.9 A44 44 0 0 1 438.6 255.1" fill="none" stroke="#22B573" stroke-width="9" stroke-linecap="round"><animate attributeName="opacity" values="1;0.45;1" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite"/></path>
<path d="M521.4 255.1 A44 44 0 0 1 521.4 284.9" fill="none" stroke="#22B573" stroke-width="9" stroke-linecap="round"><animate attributeName="opacity" values="1;0.45;1" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite"/></path>
<circle cx="480" cy="270" r="13" fill="#FFFFFF" stroke="#5B5CE2" stroke-width="6"/>
<circle cx="230" cy="180" r="7" fill="#5B5CE2"/><circle cx="730" cy="360" r="7" fill="#5B5CE2"/>
<circle cx="230" cy="360" r="7" fill="#6F5BFF"/><circle cx="730" cy="180" r="7" fill="#6F5BFF"/>
</g></svg>'''

_TRIANGLE = r'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540">
<defs><radialGradient id="glow" cx="0.5" cy="0.55" r="0.6"><stop offset="0" stop-color="#EEF0FF"/><stop offset="1" stop-color="#EEF0FF" stop-opacity="0"/></radialGradient></defs>
<ellipse cx="480" cy="290" rx="380" ry="235" fill="url(#glow)"/>
<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -6;0 0" keyTimes="0;0.5;1" dur="6s" repeatCount="indefinite"/>
<path d="M280 410 L680 410 L500 150 Z" fill="#EEF0FF" stroke="#5B5CE2" stroke-width="9" stroke-linejoin="round"/>
<path d="M330 410 A50 50 0 0 0 312.3 371.8" fill="none" stroke="#F05BB5" stroke-width="9" stroke-linecap="round"><animate attributeName="opacity" values="0.5;1;0.5" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite"/></path>
<path d="M630 410 A50 50 0 0 1 651.5 368.9" fill="none" stroke="#22B573" stroke-width="9" stroke-linecap="round"><animate attributeName="opacity" values="0.5;1;0.5" keyTimes="0;0.5;1" dur="4s" begin="1s" repeatCount="indefinite"/></path>
<path d="M526.2 187.8 A46 46 0 0 1 470.3 185.1" fill="none" stroke="#16B8D4" stroke-width="9" stroke-linecap="round"><animate attributeName="opacity" values="0.5;1;0.5" keyTimes="0;0.5;1" dur="4s" begin="2s" repeatCount="indefinite"/></path>
<circle cx="280" cy="410" r="9" fill="#F05BB5"/><circle cx="680" cy="410" r="9" fill="#22B573"/><circle cx="500" cy="150" r="9" fill="#16B8D4"/>
</g></svg>'''

_FRACTIONS = r'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540">
<defs><radialGradient id="glow" cx="0.5" cy="0.5" r="0.6"><stop offset="0" stop-color="#F1EEFF"/><stop offset="1" stop-color="#F1EEFF" stop-opacity="0"/></radialGradient></defs>
<ellipse cx="480" cy="275" rx="360" ry="235" fill="url(#glow)"/>
<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -6;0 0" keyTimes="0;0.5;1" dur="6s" repeatCount="indefinite"/>
<circle cx="480" cy="275" r="150" fill="#F3F5FF" stroke="#5B5CE2" stroke-width="8"/>
<path d="M480 275 L480 125 A150 150 0 0 1 586.1 381.1 Z" fill="#6F5BFF"><animate attributeName="opacity" values="0.72;1;0.72" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite"/></path>
<line x1="480" y1="275" x2="480" y2="125" stroke="#FFFFFF" stroke-width="4"/>
<line x1="480" y1="275" x2="586.1" y2="168.9" stroke="#FFFFFF" stroke-width="4"/>
<line x1="480" y1="275" x2="630" y2="275" stroke="#FFFFFF" stroke-width="4"/>
<line x1="480" y1="275" x2="586.1" y2="381.1" stroke="#FFFFFF" stroke-width="4"/>
<line x1="480" y1="275" x2="480" y2="425" stroke="#C2CBF2" stroke-width="4"/>
<line x1="480" y1="275" x2="373.9" y2="381.1" stroke="#C2CBF2" stroke-width="4"/>
<line x1="480" y1="275" x2="330" y2="275" stroke="#C2CBF2" stroke-width="4"/>
<line x1="480" y1="275" x2="373.9" y2="168.9" stroke="#C2CBF2" stroke-width="4"/>
<circle cx="480" cy="275" r="12" fill="#FFFFFF" stroke="#5B5CE2" stroke-width="5"/>
</g></svg>'''

_PERCENT = r'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540">
<defs><linearGradient id="bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6F5BFF"/><stop offset="1" stop-color="#16B8D4"/></linearGradient><radialGradient id="glow" cx="0.5" cy="0.5" r="0.6"><stop offset="0" stop-color="#EEF0FF"/><stop offset="1" stop-color="#EEF0FF" stop-opacity="0"/></radialGradient></defs>
<ellipse cx="480" cy="270" rx="390" ry="220" fill="url(#glow)"/>
<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" keyTimes="0;0.5;1" dur="6s" repeatCount="indefinite"/>
<rect x="230" y="196" width="500" height="46" rx="23" fill="#E7EAFB"/>
<rect x="230" y="196" width="330" height="46" rx="23" fill="url(#bar)"><animate attributeName="width" values="70;330;330;70" keyTimes="0;0.45;0.8;1" dur="7s" repeatCount="indefinite"/></rect>
<circle cx="560" cy="219" r="20" fill="#FFFFFF" stroke="#6F5BFF" stroke-width="6"><animate attributeName="cx" values="300;560;560;300" keyTimes="0;0.45;0.8;1" dur="7s" repeatCount="indefinite"/></circle>
<rect x="300" y="360" width="70" height="70" rx="14" fill="#16B8D4"><animate attributeName="opacity" values="0.6;1;0.6" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite"/></rect>
<rect x="400" y="320" width="70" height="110" rx="14" fill="#6F5BFF"><animate attributeName="opacity" values="0.6;1;0.6" keyTimes="0;0.5;1" dur="4s" begin="0.6s" repeatCount="indefinite"/></rect>
<rect x="500" y="290" width="70" height="140" rx="14" fill="#F05BB5"><animate attributeName="opacity" values="0.6;1;0.6" keyTimes="0;0.5;1" dur="4s" begin="1.2s" repeatCount="indefinite"/></rect>
<rect x="600" y="250" width="70" height="180" rx="14" fill="#22B573"><animate attributeName="opacity" values="0.6;1;0.6" keyTimes="0;0.5;1" dur="4s" begin="1.8s" repeatCount="indefinite"/></rect>
</g></svg>'''

_STATISTICS = r'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540">
<defs><linearGradient id="curve" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6F5BFF"/><stop offset="1" stop-color="#16B8D4"/></linearGradient><radialGradient id="glow" cx="0.5" cy="0.5" r="0.6"><stop offset="0" stop-color="#EEF0FF"/><stop offset="1" stop-color="#EEF0FF" stop-opacity="0"/></radialGradient></defs>
<ellipse cx="480" cy="280" rx="390" ry="220" fill="url(#glow)"/>
<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" keyTimes="0;0.5;1" dur="6s" repeatCount="indefinite"/>
<line x1="270" y1="400" x2="710" y2="400" stroke="#5B5CE2" stroke-width="8" stroke-linecap="round"/>
<line x1="270" y1="400" x2="270" y2="150" stroke="#5B5CE2" stroke-width="8" stroke-linecap="round"/>
<path d="M300 390 C390 390 420 190 480 190 C540 190 570 390 660 390" fill="none" stroke="url(#curve)" stroke-width="16" stroke-linecap="round" stroke-dasharray="900" stroke-dashoffset="0"><animate attributeName="stroke-dashoffset" values="900;0;0;900" keyTimes="0;0.4;0.75;1" dur="8s" repeatCount="indefinite"/></path>
<circle cx="380" cy="300" r="13" fill="#F05BB5"><animate attributeName="opacity" values="0.5;1;0.5" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite"/></circle>
<circle cx="480" cy="190" r="13" fill="#22B573"><animate attributeName="opacity" values="0.5;1;0.5" keyTimes="0;0.5;1" dur="4s" begin="0.8s" repeatCount="indefinite"/></circle>
<circle cx="580" cy="300" r="13" fill="#16B8D4"><animate attributeName="opacity" values="0.5;1;0.5" keyTimes="0;0.5;1" dur="4s" begin="1.6s" repeatCount="indefinite"/></circle>
</g></svg>'''

_CIRCUIT = r'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540">
<defs><radialGradient id="bulb" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#F5A623" stop-opacity="0.9"/><stop offset="1" stop-color="#F5A623" stop-opacity="0.15"/></radialGradient><radialGradient id="glow" cx="0.5" cy="0.5" r="0.6"><stop offset="0" stop-color="#EEF0FF"/><stop offset="1" stop-color="#EEF0FF" stop-opacity="0"/></radialGradient></defs>
<ellipse cx="480" cy="275" rx="390" ry="220" fill="url(#glow)"/>
<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" keyTimes="0;0.5;1" dur="6s" repeatCount="indefinite"/>
<rect x="300" y="175" width="360" height="200" rx="30" fill="none" stroke="#5B5CE2" stroke-width="9" stroke-linecap="round" stroke-dasharray="18 14"><animate attributeName="stroke-dashoffset" values="0;-320" keyTimes="0;1" dur="5s" repeatCount="indefinite"/></rect>
<line x1="430" y1="160" x2="430" y2="190" stroke="#5B5CE2" stroke-width="11" stroke-linecap="round"/>
<line x1="470" y1="168" x2="470" y2="182" stroke="#5B5CE2" stroke-width="11" stroke-linecap="round"/>
<circle cx="660" cy="275" r="52" fill="url(#bulb)" stroke="#F5A623" stroke-width="7"><animate attributeName="opacity" values="0.55;1;0.55" keyTimes="0;0.5;1" dur="3s" repeatCount="indefinite"/></circle>
<path d="M642 288 L636 258 M660 292 L660 256 M678 288 L684 258" fill="none" stroke="#F5A623" stroke-width="6" stroke-linecap="round"/>
<circle cx="300" cy="175" r="10" fill="#6F5BFF"/><circle cx="660" cy="375" r="10" fill="#16B8D4"/>
</g></svg>'''

_MATTER = r'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540">
<defs><radialGradient id="glow" cx="0.5" cy="0.5" r="0.6"><stop offset="0" stop-color="#EAF6FA"/><stop offset="1" stop-color="#EAF6FA" stop-opacity="0"/></radialGradient></defs>
<ellipse cx="480" cy="300" rx="410" ry="220" fill="url(#glow)"/>
<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" keyTimes="0;0.5;1" dur="6s" repeatCount="indefinite"/>
<rect x="140" y="205" width="185" height="185" rx="26" fill="#F3F5FF" stroke="#5B5CE2" stroke-width="5"/>
<rect x="388" y="205" width="185" height="185" rx="26" fill="#EAF6FA" stroke="#16B8D4" stroke-width="5"/>
<rect x="636" y="205" width="185" height="185" rx="26" fill="#F1EEFF" stroke="#6F5BFF" stroke-width="5"/>
<circle cx="192" cy="258" r="17" fill="#5B5CE2"/><circle cx="232" cy="258" r="17" fill="#5B5CE2"/><circle cx="272" cy="258" r="17" fill="#5B5CE2"/>
<circle cx="192" cy="298" r="17" fill="#5B5CE2"/><circle cx="232" cy="298" r="17" fill="#5B5CE2"/><circle cx="272" cy="298" r="17" fill="#5B5CE2"/>
<circle cx="192" cy="338" r="17" fill="#5B5CE2"/><circle cx="232" cy="338" r="17" fill="#5B5CE2"/><circle cx="272" cy="338" r="17" fill="#5B5CE2"/>
<g fill="#16B8D4"><animateTransform attributeName="transform" type="translate" values="0 0;0 5;0 0" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite"/><circle cx="435" cy="345" r="17"/><circle cx="475" cy="360" r="17"/><circle cx="515" cy="345" r="17"/><circle cx="455" cy="310" r="17"/><circle cx="500" cy="312" r="17"/><circle cx="480" cy="345" r="17"/></g>
<g fill="#9F7AFE"><animateTransform attributeName="transform" type="translate" values="0 0;6 -8;-4 4;0 0" keyTimes="0;0.35;0.7;1" dur="5s" repeatCount="indefinite"/><circle cx="682" cy="262" r="15"/><circle cx="740" cy="248" r="15"/><circle cx="782" cy="300" r="15"/><circle cx="700" cy="342" r="15"/><circle cx="760" cy="350" r="15"/><circle cx="726" cy="296" r="15"/></g>
</g></svg>'''

_CELL = r'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540">
<defs><radialGradient id="glow" cx="0.5" cy="0.5" r="0.6"><stop offset="0" stop-color="#EAF6FA"/><stop offset="1" stop-color="#EAF6FA" stop-opacity="0"/></radialGradient></defs>
<ellipse cx="480" cy="275" rx="400" ry="235" fill="url(#glow)"/>
<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -6;0 0" keyTimes="0;0.5;1" dur="6s" repeatCount="indefinite"/>
<ellipse cx="480" cy="275" rx="215" ry="152" fill="#EAF6FA" stroke="#16B8D4" stroke-width="8"/>
<circle cx="470" cy="270" r="58" fill="#6F5BFF" fill-opacity="0.28" stroke="#6F5BFF" stroke-width="6"><animate attributeName="r" values="56;62;56" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite"/></circle>
<circle cx="470" cy="270" r="20" fill="#6F5BFF"/>
<ellipse cx="350" cy="330" rx="46" ry="22" fill="none" stroke="#22B573" stroke-width="6" transform="rotate(-22 350 330)"/>
<ellipse cx="600" cy="215" rx="42" ry="20" fill="none" stroke="#22B573" stroke-width="6" transform="rotate(24 600 215)"/>
<circle cx="585" cy="330" r="14" fill="#F05BB5"><animateTransform attributeName="transform" type="translate" values="0 0;0 8;0 0" keyTimes="0;0.5;1" dur="5s" repeatCount="indefinite"/></circle>
<circle cx="392" cy="212" r="11" fill="#4CC9F0"><animateTransform attributeName="transform" type="translate" values="0 0;6 4;0 0" keyTimes="0;0.5;1" dur="5s" begin="1s" repeatCount="indefinite"/></circle>
</g></svg>'''

_ASTRONOMY = r'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540">
<defs><radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#F5A623"/><stop offset="1" stop-color="#F05BB5" stop-opacity="0.4"/></radialGradient><radialGradient id="glow" cx="0.5" cy="0.5" r="0.6"><stop offset="0" stop-color="#EEF0FF"/><stop offset="1" stop-color="#EEF0FF" stop-opacity="0"/></radialGradient></defs>
<ellipse cx="480" cy="270" rx="400" ry="235" fill="url(#glow)"/>
<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" keyTimes="0;0.5;1" dur="6s" repeatCount="indefinite"/>
<circle cx="480" cy="270" r="140" fill="none" stroke="#C2CBF2" stroke-width="3"/>
<circle cx="480" cy="270" r="225" fill="none" stroke="#C2CBF2" stroke-width="3"/>
<circle cx="480" cy="270" r="58" fill="url(#sun)" stroke="#F5A623" stroke-width="5"><animate attributeName="opacity" values="0.8;1;0.8" keyTimes="0;0.5;1" dur="3s" repeatCount="indefinite"/></circle>
<g><animateTransform attributeName="transform" type="rotate" values="0 480 270;360 480 270" keyTimes="0;1" dur="14s" repeatCount="indefinite"/><circle cx="620" cy="270" r="18" fill="#16B8D4"/></g>
<g><animateTransform attributeName="transform" type="rotate" values="0 480 270;-360 480 270" keyTimes="0;1" dur="24s" repeatCount="indefinite"/><circle cx="705" cy="270" r="26" fill="#6F5BFF"/><circle cx="742" cy="248" r="8" fill="#9F7AFE"/></g>
</g></svg>'''

_DEFAULT = r'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540">
<defs><linearGradient id="spark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6F5BFF"/><stop offset="1" stop-color="#16B8D4"/></linearGradient><radialGradient id="glow" cx="0.5" cy="0.5" r="0.6"><stop offset="0" stop-color="#F1EEFF"/><stop offset="1" stop-color="#F1EEFF" stop-opacity="0"/></radialGradient></defs>
<ellipse cx="480" cy="270" rx="380" ry="230" fill="url(#glow)"/>
<g><animateTransform attributeName="transform" type="rotate" values="0 480 270;360 480 270" keyTimes="0;1" dur="26s" repeatCount="indefinite"/><circle cx="480" cy="270" r="150" fill="none" stroke="#C7CFF3" stroke-width="3" stroke-dasharray="10 16"/></g>
<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -8;0 0" keyTimes="0;0.5;1" dur="5s" repeatCount="indefinite"/>
<rect x="392" y="182" width="176" height="176" rx="46" fill="#FFFFFF" stroke="#E4E8FA" stroke-width="2"/>
<circle cx="480" cy="270" r="34" fill="none" stroke="url(#spark)" stroke-width="9"/>
<circle cx="480" cy="270" r="16" fill="none" stroke="url(#spark)" stroke-width="7"/>
<circle cx="480" cy="270" r="4" fill="#6F5BFF"/>
</g>
<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -6;0 0" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite"/><circle cx="648" cy="180" r="26" fill="#D8F5E6"/><path d="M639 180 L646 188 L659 172" fill="none" stroke="#22B573" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></g>
<g><animateTransform attributeName="transform" type="translate" values="0 0;0 7;0 0" keyTimes="0;0.5;1" dur="5s" begin="0.6s" repeatCount="indefinite"/><circle cx="316" cy="300" r="26" fill="#FFFFFF" stroke="#EDEFFb" stroke-width="2"/><rect x="304" y="292" width="24" height="16" rx="5" fill="none" stroke="#6F5BFF" stroke-width="4"/></g>
<g><animateTransform attributeName="transform" type="translate" values="0 0;5 -6;0 0" keyTimes="0;0.5;1" dur="4.5s" begin="1.2s" repeatCount="indefinite"/><circle cx="648" cy="372" r="24" fill="#E3F7FB"/><path d="M648 360 L652 370 L662 372 L654 379 L656 390 L648 384 L640 390 L642 379 L634 372 L644 370 Z" fill="#16B8D4"/></g>
</svg>'''

# ─────────────────────────────────────────────────────────────────────────────
# Library assembly
# ─────────────────────────────────────────────────────────────────────────────

_TIPS = {
    "angles-types": {
        "he": "זווית חדה קטנה מפינה ישרה, וקהה גדולה ממנה — השוו כל זווית לפינת ריבוע.",
        "ar": "الزاوية الحادة أصغر من القائمة والمنفرجة أكبر — قارنوا كل زاوية بزاوية المربع.",
        "en": "An acute angle is smaller than a right angle and an obtuse one is larger — compare each to a square's corner.",
    },
    "angles-vertical": {
        "he": "זוויות קודקודיות הן הזוויות שמול זו לזו אחרי חיתוך שני ישרים — והן תמיד שוות.",
        "ar": "الزاويتان المتقابلتان بالرأس تنشآن عند تقاطع مستقيمين — وهما متساويتان دائمًا.",
        "en": "Vertical angles form opposite each other where two lines cross — and they are always equal.",
    },
    "triangle-angles": {
        "he": "סכום שלוש הזוויות בכל משולש הוא תמיד 180° — בדקו זאת בכל צורה.",
        "ar": "مجموع زوايا أي مثلث يساوي دائمًا 180° — تحقّقوا من ذلك في كل شكل.",
        "en": "The three angles of any triangle always add up to 180° — check it on every shape.",
    },
    "fractions": {
        "he": "שבר הוא חלק מתוך שלם — המכנה סופר לכמה חלקים חילקנו, והמונה כמה לקחנו.",
        "ar": "الكسر جزء من كلّ — المقام يعدّ عدد الأجزاء، والبسط كم أخذنا منها.",
        "en": "A fraction is part of a whole — the denominator counts the parts, the numerator how many you take.",
    },
    "percent": {
        "he": "אחוז הוא שבר מתוך 100 — כדי להשוות כמויות, המירו את כולן לאותו בסיס.",
        "ar": "النسبة المئوية كسر من 100 — لمقارنة الكميات حوّلوها إلى الأساس نفسه.",
        "en": "A percent is a fraction of 100 — to compare amounts, convert them to the same base.",
    },
    "statistics": {
        "he": "לפני שמסכמים נתונים, בדקו אם יש ערך חריג שמושך את הממוצע.",
        "ar": "قبل تلخيص البيانات، تحقّقوا من وجود قيمة شاذّة تسحب المتوسّط.",
        "en": "Before summarizing data, check for an outlier that pulls the average.",
    },
    "circuit": {
        "he": "זרם זורם רק במעגל סגור — עקבו אחרי הדרך מהסוללה ובחזרה אליה.",
        "ar": "يتدفّق التيار فقط في دائرة مغلقة — تتبّعوا المسار من البطارية وإليها.",
        "en": "Current flows only in a closed loop — trace the path from the battery and back to it.",
    },
    "matter-states": {
        "he": "במוצק החלקיקים צמודים, בנוזל הם זזים בקרבה, ובגז הם רחוקים וחופשיים.",
        "ar": "في الصلب تتلاصق الجسيمات، وفي السائل تتحرّك متقاربة، وفي الغاز تكون متباعدة وحرّة.",
        "en": "In a solid particles are packed, in a liquid they slide close together, in a gas they spread out freely.",
    },
    "cell": {
        "he": "לכל תא יש גבול (קרום) ומרכז בקרה (גרעין) — זהו כל חלק לפי התפקיד שלו.",
        "ar": "لكل خلية حدّ (غشاء) ومركز تحكّم (نواة) — ميّزوا كل جزء حسب وظيفته.",
        "en": "Every cell has a border (membrane) and a control center (nucleus) — identify each part by its job.",
    },
    "astronomy": {
        "he": "כוכבי הלכת נעים במסלולים סביב השמש — ככל שהמסלול רחוק יותר, ההקפה ארוכה יותר.",
        "ar": "تدور الكواكب في مدارات حول الشمس — وكلّما بعُد المدار طالت مدّة الدوران.",
        "en": "Planets travel in orbits around the sun — the farther the orbit, the longer one trip takes.",
    },
    "default": {
        "he": "פרקו את הנושא לצעדים קטנים וקשרו כל רעיון חדש למשהו שכבר מוכר לכם.",
        "ar": "قسّموا الموضوع إلى خطوات صغيرة واربطوا كل فكرة جديدة بشيء تعرفونه.",
        "en": "Break the topic into small steps and link each new idea to something you already know.",
    },
}

_PRESETS = {
    "angles-types": "angle_reveal",
    "angles-vertical": "angle_pulse",
    "triangle-angles": "angle_pulse",
    "fractions": "segment_reveal",
    "percent": "bar_fill",
    "statistics": "chart_draw",
    "circuit": "flow_path",
    "matter-states": "particle_breathe",
    "cell": "pulse_focus",
    "astronomy": "orbit",
    "default": "gentle_float",
}

_SOURCES = {
    "angles-types": _ANGLES_TYPES,
    "angles-vertical": _ANGLES_VERTICAL,
    "triangle-angles": _TRIANGLE,
    "fractions": _FRACTIONS,
    "percent": _PERCENT,
    "statistics": _STATISTICS,
    "circuit": _CIRCUIT,
    "matter-states": _MATTER,
    "cell": _CELL,
    "astronomy": _ASTRONOMY,
    "default": _DEFAULT,
}

_ANIMATION_TAG = re.compile(r"<animate(?:Transform|Motion)?\b[^>]*?/>")


def _to_static(svg: str) -> str:
    """Derive a motion-reduced variant by stripping SMIL animation elements."""
    return _ANIMATION_TAG.sub("", svg)


LIBRARY: dict[str, dict[str, Any]] = {}
for _key, _svg in _SOURCES.items():
    _asset_id = f"lib-{_key}"
    LIBRARY[_asset_id] = {
        "_id": _asset_id,
        "key": _key,
        "status": "ready_diagram",
        "mime_type": "image/svg+xml",
        "svg": _svg.strip(),
        "static_svg": _to_static(_svg.strip()),
        "animation_preset": _PRESETS[_key],
        "tips": _TIPS[_key],
    }

# Longest, most specific keywords first so e.g. "vertical" beats "angle".
_RESOLVER_RULES: list[tuple[tuple[str, ...], str]] = [
    (("vertical", "קודקוד", "متقابل", "opposite"), "angles-vertical"),
    (("triangle", "משולש", "مثلث"), "triangle-angles"),
    (("angle", "זווית", "زاوية", "geometr", "גאומטר", "هندس"), "angles-types"),
    (("percent", "אחוז", "نسبة", "مئوي"), "percent"),
    (("fraction", "שבר", "שברים", "كسر", "كسور"), "fractions"),
    (("statistic", "distribution", "average", "mean", "data", "סטטיסט", "התפלגות", "ממוצע", "נתונים", "إحصاء", "توزيع"), "statistics"),
    (("circuit", "electric", "current", "series", "מעגל", "חשמל", "זרם", "טורי", "كهرب", "دائرة", "تيار"), "circuit"),
    (("matter", "states", "solid", "liquid", "gas", "changes", "חומר", "צבירה", "מוצק", "נוזל", "גז", "مادة", "حالات"), "matter-states"),
    (("cell", "biolog", "organ", "dna", "תא", "ביולוג", "גרעין", "خلية", "أحياء"), "cell"),
    (("astro", "solar", "planet", "space", "orbit", "star", "אסטרו", "כוכב", "מסלול", "חלל", "شمس", "كوكب", "فلك"), "astronomy"),
]


def _resolve_key(objective_id: Optional[str], component_id: Optional[str]) -> str:
    """Map a lesson objective/component to a curated diagram key (or default)."""
    haystack = f"{objective_id or ''} {component_id or ''}".casefold()
    for keywords, key in _RESOLVER_RULES:
        if any(word in haystack for word in keywords):
            return key
    return "default"


async def find_for_lesson(objective_id: Optional[str], component_id: Optional[str]) -> dict[str, Any]:
    """Return the curated illustration for a lesson — always non-``None``.

    Lessons without a specific diagram resolve to the default ("lomda") visual.
    """
    return LIBRARY[f"lib-{_resolve_key(objective_id, component_id)}"]


async def get_asset(asset_id: str) -> Optional[dict[str, Any]]:
    """Return a curated asset by id, or ``None`` when unknown."""
    return LIBRARY.get(asset_id)


def public_metadata(asset: dict[str, Any], locale: str = "he") -> dict[str, Any]:
    """Project a curated asset into the dashboard illustration DTO."""
    tips = asset.get("tips") or {}
    return {
        "assetId": asset["_id"],
        "url": f"/api/learning/illustrations/{asset['_id']}.svg",
        "staticUrl": f"/api/learning/illustrations/{asset['_id']}.svg?motion=reduce",
        "alt": "",
        "tip": tips.get(locale) or tips.get("he") or "",
        "width": 960,
        "height": 540,
        "aiGenerated": False,
        "animationPreset": asset.get("animation_preset") or "gentle_float",
    }


def localized_alt(locale: str, title: str, subject: str) -> str:
    """Return a localized alt description for the lesson illustration."""
    templates = {
        "he": "איור לימודי שממחיש את הרעיון המרכזי ב{title}, בנושא {subject}.",
        "ar": "رسم تعليمي يوضّح الفكرة الرئيسية في {title} ضمن {subject}.",
        "en": "Educational illustration of the central idea in {title}, in {subject}.",
    }
    return templates.get(locale, templates["he"]).format(title=title or "", subject=subject or "")
