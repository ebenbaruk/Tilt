import React from 'react';
export function Notice({ tone = 'success', children, actions }) {
  const s = tone === 'success'
    ? { bg: 'var(--surface-success-tint)', bd: 'var(--border-success)', fg: 'var(--tilt-green-fg)' }
    : { bg: 'var(--surface-brand-tint)', bd: 'var(--border-brand-soft)', fg: 'var(--fg-2)' };
  return (
    <div role="status" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: '7px 14px', background: s.bg, borderBottom: '1px solid ' + s.bd, color: s.fg, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-base)' }}>
      <span>{children}</span>
      <span style={{ flex: 1 }}></span>
      {actions}
    </div>
  );
}
