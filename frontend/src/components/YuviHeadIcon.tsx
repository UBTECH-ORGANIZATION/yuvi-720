import type { SVGProps } from 'react'

/** Compact Yuvi head mark for message attribution and companion status UI. */
export function YuviHeadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M32 11V6" stroke="#7c6cff" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="32" cy="4.5" r="3.5" fill="#4cc9f0" />
      <rect x="7" y="27" width="8" height="18" rx="4" fill="#8dbde8" />
      <rect x="49" y="27" width="8" height="18" rx="4" fill="#8dbde8" />
      <rect x="11" y="11" width="42" height="43" rx="16" fill="#b9d8f1" />
      <path d="M17 18c8-7 23-8 32 1" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".72" />
      <rect x="16" y="20" width="32" height="26" rx="10" fill="#090b17" />
      <path d="M21 31c1.8-3.8 6.2-3.8 8 0" stroke="#74f7ff" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M35 31c1.8-3.8 6.2-3.8 8 0" stroke="#74f7ff" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M24 37c4.8 4.2 11.2 4.2 16 0" stroke="#a98cff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="12" cy="36" r="2.2" fill="#4cc9f0" />
      <circle cx="52" cy="36" r="2.2" fill="#4cc9f0" />
    </svg>
  )
}