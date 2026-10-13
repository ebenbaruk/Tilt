ASCII playing card for blackjack (and future poker). `Hand` is the labelled row.
```jsx
<Hand label="DEALER" total="10 + ?" cards={[{rank:'K',suit:'♣'},{hidden:true}]} />
<Hand label="YOU" total={19} meta="bet 500" cards={[{rank:'9',suit:'♥'},{rank:'K',suit:'♠'}]} />
```
- 7 columns × 5 lines, leading 1.15. Never render cards as images.
