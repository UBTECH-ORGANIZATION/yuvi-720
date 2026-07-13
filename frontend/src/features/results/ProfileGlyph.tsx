import type { ReactNode } from 'react'

interface ProfileGlyphProps {
  iconKey: string
}

const paths: Record<string, ReactNode> = {
  curiosity: <><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 5 5" /><path d="M10.5 7.5v6M7.5 10.5h6" /></>,
  focus: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
  independence: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2Z" /><circle cx="12" cy="12" r="1" /></>,
  organization: <><rect x="4" y="4" width="6" height="6" rx="2" /><rect x="14" y="4" width="6" height="6" rx="2" /><rect x="4" y="14" width="6" height="6" rx="2" /><path d="M14 17h6M17 14v6" /></>,
  persistence: <><path d="M3 19 9 9l3 5 3-8 6 13H3Z" /><path d="m7.5 11 2.2 1.5L12 11" /></>,
  self_awareness: <><path d="M12 3a7 7 0 0 0-4.5 12.4V20h9v-4.6A7 7 0 0 0 12 3Z" /><path d="M9.5 10.5c.8-1.7 4.2-1.7 5 0M10 14h4" /></>,
  belonging: <><circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><path d="M2.5 19c.6-3.2 2.4-5 5.5-5s4.9 1.8 5.5 5M10.5 19c.6-3.2 2.4-5 5.5-5s4.9 1.8 5.5 5" /></>,
  technology: <><rect x="3" y="4" width="18" height="13" rx="3" /><path d="M8 21h8M12 17v4" /><path d="m9 10 2 2 4-4" /></>,
  visual: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="3" /></>,
  feedback: <><path d="M4 5h16v11H9l-5 4V5Z" /><path d="M8 9h8M8 12h5" /></>,
  environment: <><path d="M18 15.5A7.5 7.5 0 0 1 8.5 6 7.5 7.5 0 1 0 18 15.5Z" /><path d="M17 4v3M15.5 5.5h3" /></>,
  interest: <><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" /></>,
  growth: <><path d="M12 21v-9" /><path d="M12 15c-4.5 0-7-2.4-7-7 4.5 0 7 2.4 7 7ZM12 12c0-4.5 2.4-7 7-7 0 4.5-2.4 7-7 7Z" /></>,
  spark: <><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z" /><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" /></>,
}

const illustrations: Record<string, ReactNode> = {
  curiosity: <>
    <circle cx="54" cy="64" r="42" fill="#5B3FD7" opacity=".18" />
    <path d="M28 100c22-17 40-28 61-30 18-2 37 3 63 18" stroke="#F2C94C" strokeWidth="5" strokeLinecap="round" opacity=".72" />
    <circle cx="93" cy="55" r="25" fill="#F9D867" stroke="#6C4CE8" strokeWidth="5" />
    <circle cx="93" cy="55" r="13" fill="#17234A" opacity=".82" />
    <path d="m111 74 27 27" stroke="#FF7A59" strokeWidth="9" strokeLinecap="round" />
    <path d="m145 23 2.7 7.3 7.3 2.7-7.3 2.7-2.7 7.3-2.7-7.3-7.3-2.7 7.3-2.7 2.7-7.3Z" fill="#54D6C4" />
  </>,
  focus: <>
    <path d="M25 104 64 31l29 21 20-29 43 81H25Z" fill="#26345F" />
    <path d="m64 31 13 9-8 11-14-3 9-17Zm49-8 13 25-16-7-10 5 13-23Z" fill="#F4F7FF" />
    <circle cx="112" cy="75" r="30" fill="#FF6B6B" opacity=".23" />
    <circle cx="112" cy="75" r="20" fill="#FFF" stroke="#FF6B6B" strokeWidth="5" />
    <circle cx="112" cy="75" r="8" fill="#FFB84D" />
    <path d="m112 75 30-31" stroke="#43C6AC" strokeWidth="5" strokeLinecap="round" />
    <path d="m140 43 11-2-3 11" fill="#43C6AC" />
  </>,
  independence: <>
    <path d="M18 102c23-3 26-31 48-34 20-3 21 17 40 14 22-4 24-35 55-42" stroke="#58C5E8" strokeWidth="8" strokeLinecap="round" strokeDasharray="3 13" />
    <circle cx="61" cy="69" r="31" fill="#FFD166" opacity=".2" />
    <circle cx="61" cy="69" r="25" fill="#FFF4C6" stroke="#EF9B35" strokeWidth="4" />
    <path d="m72 54-7 20-20 9 8-21 19-8Z" fill="#7657E8" />
    <circle cx="59" cy="68" r="4" fill="#FFF" />
    <path d="M139 26v47" stroke="#EF6A67" strokeWidth="5" strokeLinecap="round" />
    <path d="M142 28h23l-7 9 7 9h-23V28Z" fill="#EF6A67" />
  </>,
  organization: <>
    <rect x="21" y="25" width="138" height="82" rx="17" fill="#EAF8F6" stroke="#3DB7A3" strokeWidth="4" />
    <path d="M61 27v78M108 27v78" stroke="#A1DDD4" strokeWidth="3" />
    <rect x="31" y="39" width="20" height="17" rx="5" fill="#FFB84D" />
    <rect x="69" y="49" width="29" height="23" rx="6" fill="#6C5CE7" />
    <rect x="118" y="36" width="29" height="31" rx="7" fill="#59C7E8" />
    <rect x="31" y="69" width="20" height="25" rx="5" fill="#FF7F73" />
    <rect x="118" y="78" width="29" height="16" rx="6" fill="#55C59D" />
    <path d="m75 60 5 5 11-12" stroke="#FFF" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
  </>,
  persistence: <>
    <circle cx="142" cy="31" r="18" fill="#FFCD70" />
    <path d="M16 108 61 47l21 29 18-24 62 56H16Z" fill="#5B4A87" />
    <path d="m61 47 10 14-12 3-9 0 11-17Zm39 5 18 16-13-1-10 8-7-8 12-15Z" fill="#F6F2FF" />
    <path d="M96 91c13-12 22-21 37-29" stroke="#FF8A65" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 10" />
    <path d="M135 37v29" stroke="#F7F7FC" strokeWidth="4" />
    <path d="M137 39h23l-7 8 7 8h-23V39Z" fill="#50D0B1" />
  </>,
  self_awareness: <>
    <path d="M41 106c-1-37 6-67 37-79 26-10 55 6 61 30 5 20-7 31-5 49H41Z" fill="#F3D8F0" />
    <path d="M75 45c-13 5-19 17-17 30 2 14 12 21 25 25V86c-8-3-11-9-10-16 1-8 7-13 14-14V41c-4 1-8 2-12 4Z" fill="#9A5BD4" />
    <ellipse cx="117" cy="66" rx="29" ry="38" fill="#D9F3F2" stroke="#46BFB5" strokeWidth="4" />
    <path d="M108 59c6-7 16-7 21 0M108 76c5 5 16 5 21 0" stroke="#3D557A" strokeWidth="3.5" strokeLinecap="round" />
    <circle cx="108" cy="64" r="2.5" fill="#3D557A" /><circle cx="129" cy="64" r="2.5" fill="#3D557A" />
  </>,
  belonging: <>
    <circle cx="90" cy="67" r="53" fill="#E7F6EE" />
    <circle cx="90" cy="48" r="17" fill="#6C5CE7" />
    <circle cx="53" cy="61" r="14" fill="#FF8A65" />
    <circle cx="127" cy="61" r="14" fill="#48C9B0" />
    <path d="M59 108c2-23 13-36 31-36s29 13 31 36H59Z" fill="#8572EA" />
    <path d="M25 108c2-19 11-30 28-30 9 0 16 4 21 11-7 5-12 11-14 19H25Z" fill="#FFAA83" />
    <path d="M120 108c-2-8-7-14-14-19 5-7 12-11 21-11 17 0 26 11 28 30h-35Z" fill="#77D7C5" />
  </>,
  technology: <>
    <rect x="24" y="26" width="132" height="76" rx="14" fill="#14233F" stroke="#4AC7E8" strokeWidth="4" />
    <path d="M54 104h72M90 102v16" stroke="#8495B8" strokeWidth="6" strokeLinecap="round" />
    <path d="m48 67 16-16 15 13 24-25 29 28" stroke="#5EE0C5" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="48" cy="67" r="5" fill="#FFCB67" /><circle cx="79" cy="64" r="5" fill="#FF7A73" /><circle cx="103" cy="39" r="5" fill="#8C74F4" /><circle cx="132" cy="67" r="5" fill="#5EE0C5" />
    <path d="M42 87h96" stroke="#334A70" strokeWidth="3" />
  </>,
  visual: <>
    <path d="M16 66s27-39 74-39 74 39 74 39-27 39-74 39S16 66 16 66Z" fill="#E8E2FF" stroke="#7257D9" strokeWidth="4" />
    <circle cx="90" cy="66" r="28" fill="#FFF" />
    <circle cx="90" cy="66" r="18" fill="#45C4DA" />
    <circle cx="90" cy="66" r="8" fill="#17233F" />
    <circle cx="83" cy="59" r="4" fill="#FFF" opacity=".9" />
    <path d="M37 111h106" stroke="#FF7A73" strokeWidth="5" strokeLinecap="round" />
    <path d="M51 117h78" stroke="#FFCB67" strokeWidth="5" strokeLinecap="round" />
    <path d="M66 123h48" stroke="#55C8A8" strokeWidth="5" strokeLinecap="round" />
  </>,
  feedback: <>
    <path d="M18 29h94v55H57l-24 21 5-21H18V29Z" fill="#DDE8FF" stroke="#4E74D8" strokeWidth="4" strokeLinejoin="round" />
    <path d="M76 55h86v49h-19l4 17-21-17H76V55Z" fill="#FFE1D6" stroke="#ED795F" strokeWidth="4" strokeLinejoin="round" />
    <path d="M38 48h51M38 62h33M97 74h43M97 88h27" stroke="#5A6380" strokeWidth="4" strokeLinecap="round" />
    <circle cx="142" cy="39" r="15" fill="#56C8AF" />
    <path d="m135 39 5 5 9-11" stroke="#FFF" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
  </>,
  environment: <>
    <path d="M20 107h140" stroke="#5B6B92" strokeWidth="5" strokeLinecap="round" />
    <path d="M35 106V58h70v48M35 76h70" stroke="#6C5CE7" strokeWidth="5" strokeLinejoin="round" />
    <rect x="48" y="67" width="29" height="24" rx="5" fill="#5EC5E8" />
    <path d="M129 106V62" stroke="#5B6B92" strokeWidth="5" />
    <path d="M129 69c-19-2-27-14-25-31 18 1 28 12 25 31ZM130 83c17-1 27-11 28-27-17-1-28 9-28 27Z" fill="#55BE85" />
    <path d="M128 42c-10-9-10-20-4-29 11 7 14 17 4 29Z" fill="#A0D46B" />
    <circle cx="61" cy="39" r="14" fill="#FFD166" />
  </>,
  interest: <>
    <circle cx="33" cy="27" r="4" fill="#FFD166" /><circle cx="148" cy="38" r="6" fill="#5CD2C0" /><circle cx="140" cy="106" r="3" fill="#FF7A73" />
    <path d="M72 91c-17 13-31 16-40 11 3-11 13-20 29-26" fill="#F5B447" opacity=".72" />
    <path d="M72 91c-4-24 6-50 38-72 18 31 15 58-2 76L72 91Z" fill="#7A5CE0" />
    <path d="M110 19c8 13 11 25 10 36L88 35c6-6 13-11 22-16Z" fill="#59CBE8" />
    <circle cx="96" cy="57" r="10" fill="#EAF9FF" stroke="#18335B" strokeWidth="4" />
    <path d="m78 87-8 27 20-19" fill="#FF786D" />
    <path d="M61 105c-5 7-7 14-6 21M72 108c-1 8 1 14 5 20M83 106c3 6 8 11 14 15" stroke="#F7C84B" strokeWidth="4" strokeLinecap="round" />
  </>,
  growth: <>
    <path d="M17 107c23-15 48-18 73-8 26 10 47 7 73-8v28H17v-12Z" fill="#855D43" />
    <path d="M90 105V45" stroke="#459B68" strokeWidth="7" strokeLinecap="round" />
    <path d="M89 73C62 72 48 58 49 36c25-1 40 12 40 37Z" fill="#59BE78" />
    <path d="M91 58c2-24 17-38 42-38 1 23-14 38-42 38Z" fill="#8BD36E" />
    <path d="M91 90c19-1 30-11 32-28-19-2-31 8-32 28Z" fill="#45A985" />
    <circle cx="37" cy="31" r="16" fill="#FFD166" />
    <path d="M37 7v9M37 46v9M13 31h9M52 31h9" stroke="#F5B447" strokeWidth="4" strokeLinecap="round" />
  </>,
  spark: <>
    <path d="M26 96c27 16 54 16 81 0 18-11 32-28 47-52" stroke="#7157D9" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 10" />
    <path d="m78 18 7 20 20 7-20 7-7 20-7-20-20-7 20-7 7-20Z" fill="#FFD166" />
    <path d="m132 55 5 14 14 5-14 5-5 14-5-14-14-5 14-5 5-14Z" fill="#55CBB8" />
    <path d="m44 75 3 9 9 3-9 3-3 9-3-9-9-3 9-3 3-9Z" fill="#FF7B72" />
    <circle cx="143" cy="28" r="5" fill="#66B8F1" /><circle cx="105" cy="109" r="7" fill="#8E73EB" /><circle cx="22" cy="37" r="4" fill="#55CBB8" />
  </>,
}

export function ProfileGlyph({ iconKey }: ProfileGlyphProps) {
  return (
    <svg className="profile-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[iconKey] || paths.spark}
    </svg>
  )
}

export function ProfileIllustration({ iconKey }: ProfileGlyphProps) {
  return (
    <svg className="profile-illustration" viewBox="0 0 180 132" fill="none" aria-hidden="true">
      {illustrations[iconKey] || illustrations.spark}
    </svg>
  )
}
