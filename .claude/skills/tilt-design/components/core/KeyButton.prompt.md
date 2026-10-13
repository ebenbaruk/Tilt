Hotkey action button for game moves and shares; use for every clickable action inside the Tilt panel.
```jsx
<KeyButton keyLabel="H" onClick={hit}>hit</KeyButton>
<KeyButton keyLabel="x" variant="solid">post to X</KeyButton>
```
- Hover turns border + label pink, instantly (no transition).
- Label is lowercase; key letter uppercase for game moves, lowercase for share keys.
- Wire the same key on window keydown — the button is a visible reminder, not the only path.
