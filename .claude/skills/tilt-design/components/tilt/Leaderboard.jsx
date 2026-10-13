import React from 'react';
function Row({ r, n, c, you }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <span style={{ color: you ? 'var(--tilt-pink)' : 'var(--fg-6)', width: 34 }}>{r}</span>
      <span style={{ flex: 1, minWidth: 0, color: you ? 'var(--tilt-pink)' : 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</span>
      <span style={{ color: you ? 'var(--tilt-gold)' : 'var(--fg-4)' }}>{c}</span>
    </div>
  );
}
export function Leaderboard({ rows = [], you }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-base)' }}>
      <span style={{ color: 'var(--fg-6)', fontSize: 'var(--text-2xs)', letterSpacing: 'var(--tracking-eyebrow)' }}>LEADERBOARD</span>
      {rows.map(row => <Row key={row.r} {...row} />)}
      {you && <div style={{ color: 'var(--line-4)' }}>  ⋮</div>}
      {you && <Row r={you.r} n="you" c={you.c} you />}
    </div>
  );
}
