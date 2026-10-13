import React from 'react';
export function SponsorBlock({ name, pool = '$25,000', endsIn }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-base)' }}>
      <span style={{ color: 'var(--fg-6)', fontSize: 'var(--text-2xs)', letterSpacing: 'var(--tracking-eyebrow)' }}>PRESENTED BY</span>
      <span style={{ color: 'var(--fg-1)', fontSize: 'var(--text-lg)', fontWeight: 800 }}>{name}</span>
      <span style={{ color: 'var(--fg-4)' }}>season pool <span style={{ color: 'var(--tilt-gold)' }}>{pool}</span></span>
      {endsIn && <span style={{ color: 'var(--fg-6)' }}>ends in {endsIn}</span>}
    </div>
  );
}
