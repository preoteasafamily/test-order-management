import React from 'react';

const LogoSvg = ({ width = 900, height = 250, style = {} }) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 900 250"
    style={style}
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="Számlax logo"
  >
    {/* Icon Group */}
    <g transform="translate(40,40)">
      {/* Document Outline */}
      <rect x="0" y="0" width="140" height="170" rx="18" ry="18"
            fill="none" stroke="#2F5DA8" strokeWidth="10"/>
      {/* Document Lines */}
      <line x1="30" y1="50" x2="110" y2="50" stroke="#2F5DA8" strokeWidth="8" strokeLinecap="round"/>
      <line x1="30" y1="75" x2="95" y2="75" stroke="#2F5DA8" strokeWidth="8" strokeLinecap="round"/>
      <line x1="30" y1="100" x2="80" y2="100" stroke="#2F5DA8" strokeWidth="8" strokeLinecap="round"/>
      {/* Bar Chart */}
      <rect x="110" y="10" width="20" height="60" fill="#F7931E"/>
      <rect x="140" y="0" width="20" height="70" fill="#F7931E"/>
      <rect x="170" y="-15" width="20" height="85" fill="#F7931E"/>
      {/* Checkmark */}
      <polyline points="45,115 75,145 130,70"
                fill="none" stroke="#F7931E" strokeWidth="14"
                strokeLinecap="round" strokeLinejoin="round"/>
    </g>
    {/* Text */}
    <text x="280" y="145"
          fontFamily="Segoe UI, Arial, sans-serif"
          fontSize="90"
          fontWeight="700"
          fill="#1F2D3D">
      Számla
    </text>
    <text x="610" y="145"
          fontFamily="Segoe UI, Arial, sans-serif"
          fontSize="90"
          fontWeight="700"
          fill="#F7931E">
      x
    </text>
  </svg>
);

export default LogoSvg;
