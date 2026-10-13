Game switcher for the panel header; one tab per game, numbered hotkeys.
```jsx
<GameTabs active={game} onChange={setGame} tabs={[{id:'bj',keyLabel:'1',label:'Blackjack'},{id:'roulette',keyLabel:'2',label:'Roulette'},{id:'slots',keyLabel:'3',label:'Slots'}]} />
```
- Active = solid pink pill with dark text. Never more than one pink fill on screen.
- Wraps rather than truncates on narrow terminals.
