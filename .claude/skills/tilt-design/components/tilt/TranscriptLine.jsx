import React from 'react';
export function TranscriptLine({ kind = 'tool', name, arg, out, children }) {
  const base = { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-base)', lineHeight: 'var(--leading-body)' };
  if (kind === 'prompt') return <div style={{ ...base, display: 'flex', gap: 10 }}><span style={{ color: 'var(--fg-6)' }}>›</span><span style={{ color: 'var(--fg-1)' }}>{children}</span></div>;
  if (kind === 'meta') return <div style={{ ...base, color: 'var(--fg-6)' }}>{children}</div>;
  if (kind === 'done') return <div style={base}><span style={{ color: 'var(--tilt-green)' }}>✓</span> <span style={{ color: 'var(--tilt-green-fg)' }}>{children}</span></div>;
  if (kind === 'text') return <div style={{ ...base, color: 'var(--fg-2)' }}><span style={{ color: 'var(--fg-1)' }}>●</span> {children}</div>;
  return (
    <div style={base}>
      <div><span style={{ color: 'var(--tilt-green)' }}>●</span> <span style={{ color: 'var(--fg-1)', fontWeight: 700 }}>{name}</span><span style={{ color: 'var(--fg-4)' }}>({arg})</span></div>
      {out && <div style={{ color: 'var(--fg-5)', paddingLeft: 18 }}>└ {out}</div>}
    </div>
  );
}
