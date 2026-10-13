Agent transcript line used to stage realistic sessions around Tilt.
```jsx
<TranscriptLine kind="prompt">fix the flaky auth tests</TranscriptLine>
<TranscriptLine name="Bash" arg="npm test -- auth" out="38 passed, 0 failed" />
<TranscriptLine kind="done">Fixed. Auth suite is green.</TranscriptLine>
```
- Green bullets belong to the agent; Tilt never uses green for its own UI except the finish notice.
