# Prompt for Codex: build the LoadProof pitch deck (.pptx)

Copy everything below the line into Codex.

---

Build a 16:9 PowerPoint deck (.pptx) for a 3-minute hackathon pitch, using python-pptx (or pptxgenjs). Save it as
`LoadProof_pitch.pptx`. 10 slides. Few words on each slide (at most ~25), big numbers, and the full spoken text in the
speaker notes of every slide. Plain English: the presenter is not a native speaker; short sentences, no buzzwords
(no "leverage", "seamless", "robust", "revolutionary").

## The event and the team
- GDG on Campus Debrecen — Agentic AI Hackathon, Saturday 21 November 2026.
- Team: Abdi (Abdurakhmon Kuchkorov, final-year Electrical Engineering, University of Debrecen) and [TEAMMATE NAME —
  leave this placeholder].

## The project: LoadProof — "Prove the pallet before the truck leaves"

**The framing (after a mentor's feedback: "it looks like an idea, not a product you can use"): usable today with a
phone, ready for robots tomorrow.**
- **Today, any warehouse, no robot:** the worker adds each box on the phone (name, fragility soft/mid/hard, footprint
  on the standard 60 × 40 module, height, weight) and prints a label with a QR code. LoadProof plans the pallet, tests it
  in the truck simulation, and gives a **loading sheet** on the phone: step by step which box goes where, then wrap and
  straps; the worker ticks each step. Scanning a box's QR code with the phone camera shows what is inside and its step.
- **Tomorrow, where there is a robot:** the same plan drives the UR10e cell (the simulation shows it).
LoadProof is the brain of a robot palletizing cell. An AI agent reads an order, plans how to stack the boxes on a pallet,
tests the plan in a physics simulation like a truck braking and swerving, decides how to secure it (stretch wrap,
straps), and then a robot arm builds it. Every pallet gets a proof sheet. Nothing is built before it is proven.

### The problem (each number has its source — keep the source in small text on the slide)
- Up to 25% of truck accidents are linked to badly secured cargo. (European Commission, road safety: cargo securing)
- $388 million of product damage a year comes from poor pallet wrapping; 14% of pallets studied did not have enough
  wrap to hold the load to the pallet; 28,000 pallets studied. (CSCS study for Dow, reported by MH&L)
- Up to 11% of pallets arriving at a distribution centre have some damaged boxes. (Packaging Digest)
- 60% of companies learn about shipment damage only after delivery — or never. (Tive, 2025 State of Visibility report)
- The EU load test (EUMOS 40509) pushes a pallet at 0.5 g and allows a shift of at most 5% of its height — but it is a
  lab test, done after the pallet exists. Pallet planning software (TOPS Pro, Cape Pack, EasyCargo) checks geometry and
  rules, not what the load does when the truck brakes.

### How LoadProof works (draw this as one left-to-right flow on a slide)
1. **Order in** — typed in the worker's own words, e.g. "Spar Debrecen: 2 packs of water, 2 boxes of canned beans, a sack
   of rice, cereal, 2 bags of chips (they crush easily!) — long motorway trip". Gemini reads it into catalogue boxes plus
   instructions ("chips on top", "test hard braking").
2. **The agent decides, using tools** (Gemini function calling). It never places boxes itself; it calls tools and reads
   their results:
   - `plan_pallet` — a classic search finds stackings that pass the warehouse rules (full support, heavy boxes low,
     nothing on fragile boxes) and stand on their own.
   - `truck_test` — the MuJoCo physics engine shakes the pallet: EU test 0.5 g in all directions (EUMOS 40509), and
     hard braking with the road values of EN 12195-1 (0.8 g forward, 0.5 g sideways), with or without stretch wrap.
   - `straps_needed` — top-over straps that keep the whole pallet from sliding or tipping on the truck floor (the
     EN 12195-1 formula; our code reproduces the published worked example of the CARING cargo calculator, 5 of 5 values).
   - `build_pallet` — the robot builds it.
   When a test fails, the agent chooses: another arrangement, stretch wrap, or a second pallet. It finishes with a short
   message for the worker and the manager, using only the numbers the tools returned.
3. **The robot builds it** — a UR10e (Universal Robots' cobot, the real model from Google DeepMind's MuJoCo Menagerie,
   at 1:5 scale) with a vacuum gripper:
   - a 3D camera above the table finds each box in a depth picture (with sensor noise) — the robot does not read box
     positions from the simulation;
   - the vacuum cup only grips when it sits on the box top; it holds up to 339 N (assumed: 0.6 bar, 12 cm cup, safety
     factor 2) — a 20 kg box needed 360 N and dropped, as it would in reality;
   - every move is real joint motion (inverse kinematics, smooth acceleration), around the robot's base and above
     everything on the table.
4. **Proof sheet** — a printable report: the stacking plan by layer, every test with its numbers (before and after
   wrapping), wrap, straps, and the instructions the agent followed.
5. **If the AI is not available**, fixed steps call the same tools, so the cell never stops.
6. **Worker mode — a person decides, LoadProof checks.** The worker chooses a box and a spot (a click on the laptop, or a
   tap on the phone remote). LoadProof shows its own suggestion (green, starred), checks the worker's choice against the
   warehouse rules and the robot's reach before the robot moves (red, with the reason: "rests on fragile CHIPS", "the
   robot's arm would reach over the CANS behind it"), and says which box comes next. The robot places it. A worker who
   follows LoadProof builds exactly the checked plan; it passed the EU test (our tests).
7. **Phone remote** — the worker's phone becomes a handheld terminal (like the scanners warehouse workers carry): AI
   builds, I choose, stop, truck test, wrap; the boxes and a pallet picture with every spot coloured by LoadProof's verdict.
8. **What we tried and dropped:** steering the robot with your own hand through the webcam. A 2D webcam cannot give good
   control in 3D. Our conclusion: a physical remote is the right way — a phone today, and next a small copy of the arm
   that the worker moves and the big arm follows (leader–follower arms, as in the ALOHA and GELLO research projects).

### Results from our own tests (mark these "our tests" on the slides)
- A real Gemini run on the demo order (8 boxes, 57 kg of goods): EU test FAILED unwrapped (the chips fell off the back)
  → the agent decided to wrap → PASSED wrapped (at most 3 mm shift, limit 52 mm) → 1 strap → the robot built it, every
  box 1–5 mm from its planned spot.
- Truck tests of the same pallet:
  | push | unwrapped | wrapped |
  |---|---|---|
  | EU test 0.5 g | FAIL (chips fall off) | PASS (1–3 mm) |
  | hard braking 0.8 g + swerve 0.5 g (EN 12195-1) | FAIL (259 mm) | PASS (2 mm) |
- Knock a box: unwrapped, the robot finds it with the camera and puts it back; wrapped, the film holds it (16 mm).
- Compare: the same 8 boxes stacked by a "rushed worker" (in arrival order, in columns) fall in the truck test; the
  LoadProof pallet holds.

### Honest limits (one slide, short — judges respect this)
- It is a simulation and a planning check, not a certification.
- The final "measured" check after each box still uses the simulation's positions; a real cell would rescan with the camera.
- The arm's own weight compensation is ideal; the cup values are assumed, not a datasheet.
- UR10e payload is 12.5 kg (UR datasheet): heavier boxes (paper 20 kg, books 15 kg) need a bigger arm (UR20) or a person.

### Next steps
- A manager page: every pallet live — planned, built, tested, wrapped, ready — with the agent's reasons.
- A small leader arm as the physical remote: the worker moves it, the UR10e follows — the manual control next to the
  automatic one ("wherever there is an electrical controller, there should be a mechanical one").
- A real tray test with real boxes, to compare the simulation with reality.
- Show the webcam real boxes and let the AI recognise them into an order.

## Slide plan
1. Title — "LoadProof — prove the pallet before the truck leaves." Subtitle: "Usable today with a phone, ready for
   robots tomorrow." Event, team.
2. The problem — the 25% number big; $388 M and 60% smaller under it. Picture: the rushed pallet falling (screenshot).
3. Why it still happens — planned by hand or by geometry tools; the EU test is in a lab, after the pallet exists.
4. LoadProof in one picture — boxes in (phone: add box, QR label) → agent → physics truck tests → wrap and straps →
   loading sheet on the phone (a person loads) or the robot builds it → proof sheet.
5. The agent at work — the real log of one run (shorten it): plan → EU test failed → wrap → passed → 1 strap → build.
6. Physics proof — the wrapped/unwrapped table; "nothing is built before it passes".
7. The robot cell — UR10e 1:5 digital twin, 3D camera, vacuum cup with a force limit; picture of the cell.
8. People stay in control — worker mode and the phone remote (screenshot of the phone page), the proof sheet, and a
   simple mock-up of a manager page (pallet cards: planned / built / tested / wrapped / ready). One line: "we tried the
   webcam; a 2D camera cannot steer in 3D — a physical remote is the right way".
9. Honest limits and next steps.
10. Live demo — "Type an order. Watch it get proven." + thanks.

## Look
- Dark background #0f1720, text #e6edf3, dim text #8b949e; accents: blue #1f6feb (LoadProof), green #3fb950 (pass),
  red #f85149 (fail), wood #c8a06a (boxes). One sans-serif font (e.g. Segoe UI or Inter).
- Big numbers in accent colours, sources in 10-pt dim text at the bottom of the slide.
- Use the screenshots in `pitch/shots/` if they exist (compare.jpg: the two pallets side by side before the truck test;
  camera.png: the 3D camera view; and, if added, compare_fall.png, agent_log.png, report.png);
  otherwise leave a grey box with a caption saying which screenshot goes there.

## Speaker notes (about 3 minutes in total, ~20 seconds a slide)
Write them in first person, short sentences, the way a person speaks. Use only the facts above. Slide 2 opens with:
"Up to a quarter of truck accidents in Europe are linked to cargo that was not secured properly."
