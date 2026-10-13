import React from 'react';
const FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
export function Spinner({ verb = 'Working', meta }) {
  const [i, setI] = React.useState(0);
  React.useEffect(() => { const t = setInterval(() => setI(n => n + 1), 200); return () => clearInterval(t); }, []);
  return (
    <div style={{ color: 'var(--tilt-gold)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-base)' }}>
      {FRAMES[i % FRAMES.length]} {verb}… {meta && <span style={{ color: 'var(--fg-6)' }}>({meta})</span>}
    </div>
  );
}
