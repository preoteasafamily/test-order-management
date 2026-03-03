import React from 'react';

const LogoSvg = ({ width = 64, height = 64, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width={width} height={height} className={className}>
    <text x="32" y="46" fontFamily="Arial,sans-serif" fontSize="38" fontWeight="bold" textAnchor="middle" fill="#1e40af">S</text>
  </svg>
);

export default LogoSvg;
