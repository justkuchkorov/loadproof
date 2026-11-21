# Examples

- `demo-boxes.json` — the 6 boxes of our live demo. Two more boxes, added live from a phone, still stack safely in
  6 of 7 cases we measured (`node tests/explore_orders.mjs`), and the "rushed worker" stack falls in all 7.
  Load them into a running dev server: `node tools/load_examples.mjs` (replaces the box list), then open
  `http://localhost:5173/boxes.html` and press **Load into LoadProof**, or open `http://localhost:5173/#boxes`.
- Catalogue orders straight from the address bar:
  - `http://localhost:5173/#order=RUG,RUG,RUG,RICE,RICE,CANS,WATER` — LoadProof passes unwrapped, the rushed stack falls apart.
  - `http://localhost:5173/#order=TV,WATER,WATER,JARS,JARS` — two kinds of fragile goods.
  - `http://localhost:5173/#order=CHIPS,CHIPS,JARS,JARS,TV,CEREAL` — no safe stacking exists; LoadProof says which box to move.
  - `http://localhost:5173/#order=BOOKS,BOOKS,RICE,RICE,CANS,TILES,CHIPS,CHIPS` — books and tiles are over the UR10e's payload.
- Add `?noai` to any address to plan without Gemini (the same tools in fixed steps).
