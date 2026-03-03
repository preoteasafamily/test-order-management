import React from 'react';

const LogoSvg = ({ size = 64 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 64 64"
    width={size}
    height={size}
    aria-label="Samlax logo"
  >
    <circle cx="32" cy="32" r="30" fill="#1e40af" />
    <text
      x="32"
      y="46"
      fontFamily="Arial,sans-serif"
      fontSize="38"
      fontWeight="bold"
      textAnchor="middle"
      fill="#ffffff"
    >
      S
    </text>
  </svg>
);

export default LogoSvg;
