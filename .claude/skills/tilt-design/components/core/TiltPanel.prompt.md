The container for everything Tilt renders inside the agent CLI.
```jsx
<TiltPanel tabs={<GameTabs …/>} stats={<><Stat label="chips" value="18,450" tone="money"/><Stat label="rank" prefix="#" value="412"/></>} side={<><SponsorBlock …/><Leaderboard …/></>}>
  …game, message line, KeyButtons…
</TiltPanel>
```
- The pink frame is the boundary between "agent" and "game". Nothing pink lives outside it except the collapsed TILT line.
- Sidebar is 260px; drop it under ~720px terminal width.
