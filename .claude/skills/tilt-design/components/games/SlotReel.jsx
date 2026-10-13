import React from 'react';
const COLORS = { '7': 'var(--tilt-pink)', '★': 'var(--tilt-gold)' };
export function SlotReel({ symbol = '7', size = 78 }) {
  return (
    <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-control)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-well)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-display)', fontWeight: 800, color: COLORS[symbol] || 'var(--fg-1)' }}>{symbol}</div>
  );
}
export function SlotMachine({ symbols = ['7','★','◆'] }) {
  return <div style={{ display: 'flex', gap: 10 }}>{symbols.map((s, i) => <SlotReel key={i} symbol={s} />)}</div>;
}
