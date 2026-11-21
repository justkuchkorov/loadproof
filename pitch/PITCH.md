# LoadProof — 3-minute pitch (draft for Abdi to say in his own words)

Plain sentences, one idea each. Say it, don't read it. Numbers marked (source) are checked; (ours) come from our tests.

## 0:00 — The hook (demo running: ⚖️ Compare is already on screen)

"Up to a quarter of truck accidents in Europe are linked to cargo that was not secured properly." (European Commission)

"Look at these two pallets. Same eight boxes. Same height. Both stand perfectly. Which one survives the truck?"

→ press 🚚 Truck test. The rushed one falls, LoadProof holds.

"The left one moved 1 millimetre. The right one threw a box 1.6 metres." (ours)

## 0:40 — The problem

"Mixed boxes are still mostly stacked by hand." (MMH logistics magazine)
"Europe has a test for this: EUMOS 40509 pushes a pallet at half of gravity — like a truck braking hard — and it may
shift at most 5% of its height." (Lansmont, EUMOS)
"But that test is done on a machine, in a lab, AFTER the pallet exists. Nobody tests the plan before stacking."

## 1:00 — What LoadProof does

"LoadProof tests the pallet before a single box is touched."
1. "An AI — Gemini — plans the stacking for the order." (≈1–2 seconds, ours)
2. "Before anything is built, three checks: warehouse rules, does it stand, and the 0.5 g truck test in a physics
   simulation."
3. "If it fails, the AI gets the numbers back and fixes the plan. It also remembers its lessons."
4. "Only a plan that passes is built. The robot hand builds it and measures every box."

## 1:40 — Live, unscripted

"You choose the order." → a judge presses 🎲 Random (or picks boxes) → Load → LoadProof.
"6 out of 6 random orders got a passing plan on the first try in our tests." (ours)
→ 💥 Knock a box: "Someone bumps the pallet — the robot measures everything and puts it back." (4/4 in our tests)

## 2:20 — How it is built

- Gemini plans (asked 3 times in parallel, the best plan is kept, lessons from earlier failures go back in).
- MuJoCo physics (by Google DeepMind) runs in the browser: the truck test takes about 2 seconds.
- MediaPipe hand tracking: a person can take over the robot hand with a normal webcam.
- Everything runs in one web page.

## 2:40 — Honest limits, next step

"This is a 1:5 simulation. The robot's grip is assisted, like a suction gripper. It is a planning check, not a
certification. Next: whole trucks, and a real robot cell."

## 3:00 — Close

"Same boxes. Same height. One survives the truck. LoadProof tells you which — before you stack."

---

## Questions judges may ask (short answers)

- **Why a hand, not a suction gripper?** Robots with hands are coming to warehouses (for example Remy AI, Y Combinator
  W26, builds robots with hands for packing stations). The method works with any gripper.
- **Is the AI really needed, or is it rules?** The rules only CHECK. The AI PROPOSES plans for any order; physics
  decides. Without the checks the AI is not trusted; without the AI there is no plan for a new order.
- **How do you know the physics is right?** It matches the tipping rule: a stack tips when the push in g is bigger
  than width / height. Our 4-cube tower (w/h = 0.25) failed at 0.5 g; a single cube (w/h = 1) passed.
- **What about 0.8 g?** EN 12195-1 uses 0.8 g forward (braking) and 0.5 g sideways and backward. At 0.6 g and above
  any unwrapped box with friction 0.6 slides, however it is stacked — that is why trucks use straps and the front
  wall. Our plan holds to 0.5 g, 0.6 g with stretch wrap; the rushed stack fails from 0.3 g. (ours)
- **Did you use AI to build it?** Yes, openly: the code was written with AI assistants during the hackathon; the
  design, the tests and the checks we can explain.

## Sources

- European Commission, road safety — cargo securing: "Up to 25% of truck accidents are linked to poorly secured cargo".
  road-safety.transport.ec.europa.eu/eu-road-safety-policy/priorities/safe-vehicles/cargo-securing-and-abnormal-loads_en
- EUMOS 40509 test method (Lansmont): lansmont.com/standards/eumos-40509 ; acceleration test (Wikipedia).
- EN 12195-1 coefficients 0.8 g forward, 0.5 g sideways and backward (tis-gdv.de, containerhandbuch.de).
- Mixed-case palletizing mostly manual: mmh.com, "Solving the mixed case pallet puzzle".
- Anti-slip sheets, slip angle 30–45°: smurfitkappa.com, corrugated sheet board anti-slip.
- Startups: YK-Robotics €1M seed (dealroom.co, Oct 2026); AutoPallet Robotics (YC); Remy AI (YC W26).
