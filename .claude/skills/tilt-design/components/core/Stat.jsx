import React from 'react';
export function Stat({ label, value, tone = 'default', prefix = '' }) {
  const color = tone === 'money' ? 'var(--tilt-gold)' : tone === 'brand' ? 'var(--tilt-pink)' : 'var(--fg-1)';
  return (
    <span style={{ whiteSpace: 'nowrap', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-base)' }}>
      {label} <span style={{ color, fontWeight: tone === 'money' ? 700 : 400 }}>{prefix}{value}</span>
    </span>
  );
}
