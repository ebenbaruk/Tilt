import React from 'react';
export function TiltPanel({ season = 'S3', tabs, stats, notice, side, children }) {
  return (
    <section aria-label="Tilt" style={{ border: '1px solid var(--border-brand)', borderRadius: 'var(--radius-md)', overflow: 'hidden', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-base)', lineHeight: 'var(--leading-body)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, padding: '8px 14px', background: 'var(--surface-brand-tint)', borderBottom: '1px solid var(--border-brand-soft)' }}>
        <span style={{ color: 'var(--tilt-pink)', fontWeight: 800, letterSpacing: 'var(--tracking-wordmark)' }}>TILT</span>
        <span style={{ color: 'var(--fg-6)' }}>{season}</span>
        {tabs}
        <span style={{ flex: 1 }}></span>
        {stats}
      </div>
      {notice}
      <div style={{ display: 'grid', gridTemplateColumns: side ? 'minmax(0,1fr) var(--side-column)' : 'minmax(0,1fr)' }}>
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 'var(--game-min-height)' }}>{children}</div>
        {side && <aside style={{ borderLeft: '1px solid var(--border-default)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>{side}</aside>}
      </div>
    </section>
  );
}
