import React from 'react';
import { KeyButton } from '../core/KeyButton.jsx';
export function WinCard({ amount, game, sponsor, caption, onShare, shareStatus }) {
  return (
    <div style={{ border: '1px solid var(--border-win)', borderRadius: 'var(--radius-md)', padding: '12px 14px', background: 'var(--surface-win-tint)', display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-base)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--tilt-gold)', fontWeight: 800, letterSpacing: 'var(--tracking-banner)' }}>★ BIG WIN +{amount}</span>
        {sponsor && <span style={{ color: 'var(--fg-5)' }}>win powered by <span style={{ color: 'var(--fg-1)' }}>{sponsor}</span></span>}
      </div>
      <div style={{ color: 'var(--fg-3)' }}>{caption || ('“won ' + amount + ' on ' + game + ' while my agent shipped”')} · share card ready</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <KeyButton keyLabel="x" variant="solid" onClick={() => onShare && onShare('x')}>post to X</KeyButton>
        <KeyButton keyLabel="k" onClick={() => onShare && onShare('tiktok')}>TikTok</KeyButton>
        {shareStatus && <span style={{ color: 'var(--fg-5)' }}>{shareStatus}</span>}
      </div>
    </div>
  );
}
