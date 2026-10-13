import React from 'react';
export function GameTabs({ tabs = [], active, onChange }) {
  return (
    <div role="tablist" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {tabs.map(t => {
        const on = t.id === active;
        return (
          <span key={t.id} role="tab" aria-selected={on} onClick={() => onChange && onChange(t.id)}
            style={{ cursor: 'pointer', whiteSpace: 'nowrap', padding: '1px 8px', borderRadius: 'var(--radius-xs)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-base)',
              color: on ? 'var(--text-on-light)' : 'var(--fg-4)', background: on ? 'var(--tilt-pink)' : 'transparent' }}>
            [{t.keyLabel}] {t.label}
          </span>
        );
      })}
    </div>
  );
}
