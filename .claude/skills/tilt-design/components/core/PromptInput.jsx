import React from 'react';
export function PromptInput({ placeholder = 'Ask the agent…', value, onChange }) {
  return (
    <label style={{ border: '1px solid var(--line-2)', borderRadius: 'var(--radius-md)', padding: '8px 12px', display: 'flex', gap: 10, alignItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-base)' }}>
      <span style={{ color: 'var(--fg-6)' }}>›</span>
      <input value={value} onChange={e => onChange && onChange(e.target.value)} placeholder={placeholder}
        style={{ flex: 1, background: 'transparent', border: 0, outline: 'none', color: 'var(--fg-1)', font: 'inherit', padding: 0 }} />
    </label>
  );
}
