import React from 'react';
function pad(s, n, left) { while (s.length < n) s = left ? ' ' + s : s + ' '; return s; }
export function PlayingCard({ rank = 'A', suit = '♠', hidden = false }) {
  const red = suit === '♥' || suit === '♦';
  const art = hidden
    ? '┌─────┐\n│░░░░░│\n│░░░░░│\n│░░░░░│\n└─────┘'
    : '┌─────┐\n│' + pad(rank, 2) + '   │\n│  ' + suit + '  │\n│   ' + pad(rank, 2, true) + '│\n└─────┘';
  return (
    <pre aria-label={hidden ? 'hidden card' : rank + ' of ' + suit} style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-base)', lineHeight: 'var(--leading-card)', color: hidden ? 'var(--line-4)' : red ? 'var(--tilt-red)' : 'var(--fg-1)' }}>{art}</pre>
  );
}
export function Hand({ label, total, meta, cards = [] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-base)' }}>
      <div style={{ color: 'var(--fg-5)' }}>{label} <span style={{ color: 'var(--fg-1)' }}>{total}</span>{meta && <span style={{ color: 'var(--fg-6)' }}> · {meta}</span>}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minHeight: 86 }}>{cards.map((c, i) => <PlayingCard key={i} {...c} />)}</div>
    </div>
  );
}
