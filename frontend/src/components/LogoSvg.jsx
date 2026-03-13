import React from 'react';

const LogoSvg = ({ className = '', width, height }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 110 90"
    className={className}
    width={width}
    height={height}
    aria-label="Számla x"
  >
    {/* Document body */}
    <rect x="8" y="2" width="56" height="72" rx="5" ry="5" fill="#1e40af" />
    {/* Folded corner cutout */}
    <polygon points="46,2 64,20 46,20" fill="#1e3a8a" />
    {/* Document lines */}
    <rect x="18" y="26" width="36" height="4" rx="2" fill="white" opacity="0.85" />
    <rect x="18" y="36" width="28" height="4" rx="2" fill="white" opacity="0.85" />
    <rect x="18" y="46" width="32" height="4" rx="2" fill="white" opacity="0.85" />
    <rect x="18" y="56" width="22" height="4" rx="2" fill="white" opacity="0.85" />
    {/* Text "Számla x" */}
    <text
      x="86"
      y="42"
      fontFamily="Arial, sans-serif"
      fontSize="13"
      fontWeight="bold"
      fill="#1e40af"
      textAnchor="middle"
    >
      Számla
    </text>
    <text
      x="86"
      y="58"
      fontFamily="Arial, sans-serif"
      fontSize="13"
      fontWeight="bold"
      fill="#1e40af"
      textAnchor="middle"
    >
      x
    </text>
  </svg>
);

export default LogoSvg;
