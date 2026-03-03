import React from 'react';

const InvoiceIcon = ({ className = '' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 64 64"
    className={className}
    aria-label="Logo"
  >
    {/* Document body */}
    <rect x="10" y="4" width="38" height="50" rx="4" ry="4" fill="#1e40af" />
    {/* Folded corner */}
    <polygon points="38,4 48,14 38,14" fill="#93c5fd" />
    {/* Lines representing invoice content */}
    <rect x="16" y="22" width="24" height="3" rx="1" fill="#ffffff" opacity="0.9" />
    <rect x="16" y="30" width="20" height="3" rx="1" fill="#ffffff" opacity="0.7" />
    <rect x="16" y="38" width="22" height="3" rx="1" fill="#ffffff" opacity="0.7" />
    {/* Small accent line */}
    <rect x="16" y="46" width="14" height="3" rx="1" fill="#93c5fd" />
  </svg>
);

export default InvoiceIcon;
