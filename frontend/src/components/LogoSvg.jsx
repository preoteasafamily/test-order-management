import React from 'react';

const LogoSvg = ({ width = 80, height = 80, className = '' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 100 100"
    width={width}
    height={height}
    className={className}
    aria-label="Samlax logo"
  >
    {/* Document background */}
    <rect x="10" y="5" width="65" height="82" rx="4" ry="4" fill="#ffffff" stroke="#d1d5db" strokeWidth="1.5" />

    {/* Top orange header bar */}
    <rect x="10" y="5" width="65" height="14" rx="4" ry="4" fill="#f97316" />
    <rect x="10" y="13" width="65" height="6" fill="#f97316" />

    {/* "Számla" text in header */}
    <text x="42" y="16" fontFamily="Arial, sans-serif" fontSize="8" fontWeight="bold" fill="#ffffff" textAnchor="middle">Számla</text>

    {/* Document lines */}
    <rect x="18" y="26" width="42" height="3" rx="1" fill="#e5e7eb" />
    <rect x="18" y="33" width="34" height="3" rx="1" fill="#e5e7eb" />

    {/* Orange bar row 1 */}
    <rect x="18" y="42" width="49" height="7" rx="2" fill="#fed7aa" />
    <rect x="18" y="42" width="4" height="7" rx="1" fill="#f97316" />
    <rect x="25" y="44" width="22" height="3" rx="1" fill="#9ca3af" />
    <rect x="58" y="44" width="9" height="3" rx="1" fill="#f97316" />

    {/* Orange bar row 2 */}
    <rect x="18" y="53" width="49" height="7" rx="2" fill="#fed7aa" />
    <rect x="18" y="53" width="4" height="7" rx="1" fill="#f97316" />
    <rect x="25" y="55" width="18" height="3" rx="1" fill="#9ca3af" />
    <rect x="58" y="55" width="9" height="3" rx="1" fill="#f97316" />

    {/* Separator line */}
    <line x1="18" y1="65" x2="67" y2="65" stroke="#e5e7eb" strokeWidth="1" />

    {/* Total row */}
    <rect x="18" y="69" width="49" height="7" rx="2" fill="#fff7ed" />
    <rect x="25" y="71" width="14" height="3" rx="1" fill="#6b7280" />
    <rect x="56" y="71" width="11" height="3" rx="1" fill="#f97316" />

    {/* Checkmark circle (bottom right, overlapping document) */}
    <circle cx="72" cy="78" r="14" fill="#22c55e" />
    <polyline points="64,78 70,84 80,70" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />

    {/* "x" text label */}
    <text x="88" y="18" fontFamily="Arial, sans-serif" fontSize="14" fontWeight="bold" fill="#f97316" textAnchor="middle">x</text>
  </svg>
);

export default LogoSvg;
