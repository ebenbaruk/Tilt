import React from 'react';
export function KeyButton({ keyLabel, children, onClick, variant = 'default', disabled = false }) {
  const [hover, setHover] = React.useState(false);
  const solid = variant === 'solid';
  const ghost = variant === 'ghost';
  const style = {
    display: 'inline-flex', alignItems: 'center', gap: 6, cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap',
    padding: '3px 10px', borderRadius: 'var(--radius-xs)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-base)',
    border: ghost ? '1px solid transparent' : '1px solid ' + (hover && !solid && !disabled ? 'var(--tilt-pink)' : 'var(--border-control)'),
    background: solid ? 'var(--fg-1)' : 'transparent',
    color: solid ? 'var(--text-on-light)' : disabled ? 'var(--fg-7)' : hover ? 'var(--tilt-pink)' : 'var(--fg-1)',
    fontWeight: solid ? 700 : 400, opacity: disabled ? .6 : 1, userSelect: 'none'
  };
  return (
    <span role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} style={style}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={disabled ? undefined : onClick}
      onKeyDown={e => { if (!disabled && (e.key === 'Enter')) onClick && onClick(e); }}>
      {keyLabel != null && <span style={{ color: solid ? 'inherit' : 'var(--tilt-gold)' }}>{solid ? '[' + keyLabel + ']' : keyLabel}</span>}
      {children}
    </span>
  );
}
