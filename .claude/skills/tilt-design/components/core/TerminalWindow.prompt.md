The terminal frame that every Tilt surface lives inside; use it as the outermost container of a mock.
```jsx
<TerminalWindow title="~/acme-api — agent">…session lines, TiltPanel, PromptInput…</TerminalWindow>
```
- Body is a 12px-gap flex column; children stack.
- Neutral traffic-light dots on purpose: no OS branding.
