# LoadProof — overnight build plan (21 Nov 2026)

Agreed with Abdi at 01:45: build ALL the improvements, one by one, each as its own commit, so any one can be removed
later. He sleeps; the laptop stays plugged in with the lid OPEN (closing it sleeps the laptop). Event: 10:00–19:00.

## How to resume (read this first after any interruption)

1. Read this file, then `git log --oneline -15` in this folder.
2. Continue with the first item below that is not `[x]`. Mark items `[x]` here when done and committed.
3. Every item: build it, test it in Node (`tests/`) and in headless Chrome (screenshot), commit with a clear message.
4. Never break the main demo: after each item run
   `node tests/agent_build.mjs --plan-file tests/plans/ai_1.json` (all 8 heights right) and
   `node tests/pallet_physics.mjs` (rushed fails, planned passes).
5. Shell: heredocs with apostrophes break this shell — write patch scripts with the Write tool, run them with node.
6. If the 5-hour usage limit stops work: it resets at 04:30. Session reminders (CronCreate) restart the work.
7. When all items are done: update `C:\Users\abdi\Documents\AK\job-search\state.md` (what was built, results),
   commit there, delete the reminders (CronList / CronDelete), and write the morning summary at the bottom of this file.

## Items (in order)

- [x] 1. Random / chosen orders. A catalogue of box types that fit the pallet spots (small 30×40, wide 60×40,
      long 30×80 cm; different heights, weights, fragile). Order builder in the panel (+/− per type) and a 🎲 Random
      button. Changing the order rebuilds the scene. The AI plans any order; checks as now. "Show plan" places the
      checked plan at once; the robot build stays available (warn that the tested build is the demo order).
- [x] 2. Side by side: a second pallet. "Compare" puts the rushed stack on one pallet and the LoadProof plan on the
      other (placed at once), then one truck test shakes both; the result names both.
- [x] 3. Lessons learned: every checked plan is saved in the browser (order, plan, result, why it failed). The
      lessons go into the AI prompt. The panel shows "plans tested / failed / lessons".
- [x] 4. Sabotage: a "Knock a box" button pushes one box of the finished pallet off; the robot measures the whole
      pallet, finds what moved and puts it back.
- [x] 5. Stretch wrap: a wrap option (boxes held together softly, as wrap does). If no stacking passes, the AI
      recommends wrapping; the truck test shows the difference.
- [x] 6. Load stability report: one printable page per pallet — order, layers, checks, truck test numbers, PASS/FAIL.
- [x] 7. Push slider: 0.3–0.8 g for the truck test (0.5 g = EU test EUMOS 40509; 0.8 g = emergency braking).
- [x] 8. Pitch: a 3-minute script, 3–4 slides, and a backup recording of the demo (frames from headless Chrome).
      Before naming any packaging standard (ISO 3394?), check it.
- [ ] 9. Later, only after 1–8 work and Abdi agrees: a whole-truck simulation.

## Morning summary (written 02:15)

All of 1-8 are built, tested and committed, one commit each (any one can be removed: ).
Item 9 (whole truck) is NOT started: it waits for your yes.

**Open the app:**  in this folder, then http://localhost:5173 (slides: /pitch/slides.html,
backup recording: /pitch/backup.html, both work offline).

**Try each, in this order (about 5 minutes):**
1. ⚖️ Compare, then 🚚 Truck test: LoadProof pallet PASSES (1 mm), rushed pallet FAILS (about 1.5 m).
2. R, then 🤖 LoadProof: plan & build (robot switch on): the robot builds the 8 boxes from the group on the left.
3. 💥 Knock a box: one top box is shoved; the robot measures every box and puts it back.
4. 🎞 Wrap, then 🚚 Truck test: film around the load. Then move the push slider to 0.8 g and test again.
5. 📄 Report: a printable page (allow pop-ups if the browser asks).
6. change order -> 🎲 Random order -> Load this order -> LoadProof. Turn the robot switch off for a quick result.
7. 🧠 Memory (under the buttons): lessons collect as plans are checked.
8. ⏺ Record (top right): record your own backup video in the morning, in full quality.

**Test results (Node, same code as the page):**
- AI planned 6/6 random orders, each on the first try, 1-4 s. The robot built 3/3 random orders.
- The demo order's AI plan builds 4/4 with uneven frame times. Knocked boxes repaired 4/4.
- Push strength: rushed fails from 0.3 g; AI plan holds to 0.5 g (0.6 g wrapped); rushed + wrap still fails 0.5 g.
- Above 0.6 g any unwrapped box slides (friction 0.6): EN 12195-1 uses 0.8 g forward, so real trucks need straps.

**If time is short at the event, cut in this order:** 7 (memory panel) -> 6 (report) -> 5 (wrap) -> 1 (editor).
Keep Compare + Truck test + the robot build: that is the story.

**Pitch:** pitch/PITCH.md (a draft to say in your own words: every number has its source or is marked ours),
pitch/slides.html (4 slides, arrow keys, f = full screen).

**Known limits (say them before a judge does):** 1:5 simulation; assisted grip (a lock, like a suction gripper); the
forearm stub does not collide (an arm from above is assumed); wrap is a spring model; a planning check, not a
certification. The robot build is tested on the demo order and three random orders, not on every order.
