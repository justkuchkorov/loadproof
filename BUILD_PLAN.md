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
- [ ] 3. Lessons learned: every checked plan is saved in the browser (order, plan, result, why it failed). The
      lessons go into the AI prompt. The panel shows "plans tested / failed / lessons".
- [ ] 4. Sabotage: a "Knock a box" button pushes one box of the finished pallet off; the robot measures the whole
      pallet, finds what moved and puts it back.
- [ ] 5. Stretch wrap: a wrap option (boxes held together softly, as wrap does). If no stacking passes, the AI
      recommends wrapping; the truck test shows the difference.
- [ ] 6. Load stability report: one printable page per pallet — order, layers, checks, truck test numbers, PASS/FAIL.
- [ ] 7. Push slider: 0.3–0.8 g for the truck test (0.5 g = EU test EUMOS 40509; 0.8 g = emergency braking).
- [ ] 8. Pitch: a 3-minute script, 3–4 slides, and a backup recording of the demo (frames from headless Chrome).
      Before naming any packaging standard (ISO 3394?), check it.
- [ ] 9. Later, only after 1–8 work and Abdi agrees: a whole-truck simulation.

## Morning summary

(written at the end)
