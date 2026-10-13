import React from 'react';
export function TerminalWindow({ title = '~/project — agent', children, maxWidth = 'var(--window-max)' }) {
  const dot = { width: 12, height: 12, borderRadius: '50%', background: 'var(--line-3)' };
  return (
    <div style={{ width: '100%', maxWidth, background: 'var(--surface-terminal)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-window)', fontFamily: 'var(--font-mono)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--surface-chrome)', borderBottom: '1px solid var(--border-default)' }}>
        <span style={dot}></span><span style={dot}></span><span style={dot}></span>
        <span style={{ flex: 1, textAlign: 'center', fontSize: 'var(--text-xs)', color: 'var(--fg-4)' }}>{title}</span>
      </div>
      <div style={{ padding: '18px 22px 14px', fontSize: 'var(--text-base)', lineHeight: 'var(--leading-body)', color: 'var(--text-body)', display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  );
}
