import React from 'react';
const RED = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
export function pocketColor(n) { return n === 0 ? 'green' : RED.indexOf(n) >= 0 ? 'red' : 'black'; }
export function RouletteStrip({ value = 0, reach = 4 }) {
  const cells = [];
  for (let o = -reach; o <= reach; o++) {
    const n = ((value + o) % 37 + 37) % 37, c = pocketColor(n);
    cells.push(
      <span key={o} style={{ width: 38, textAlign: 'center', padding: '6px 0', borderRadius: 'var(--radius-xs)', fontWeight: 700, color: 'var(--fg-1)',
        background: c === 'red' ? 'var(--felt-red)' : c === 'green' ? 'var(--felt-green)' : 'var(--felt-black)',
        opacity: o === 0 ? 1 : 0.4 - Math.abs(o) * 0.05, outline: o === 0 ? '2px solid var(--tilt-gold)' : 'none' }}>{n}</span>
    );
  }
  return <div aria-label={'ball on ' + value} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-base)' }}>{cells}</div>;
}
