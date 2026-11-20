# Times Gemini models on the same planning job and checks each plan against simple building rules.
# Run: python tests/planner_bench.py   (reads the key from .env.local; never prints it)
import json, time, urllib.request, urllib.error, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
KEY = next(l.split('=', 1)[1].strip() for l in (ROOT / '.env.local').read_text().splitlines() if l.startswith('VITE_GEMINI_API_KEY='))

SYSTEM = """You plan block structures for a robot hand on a table. Units: metres. Table top is z=0.
x = forward (0.05 to 0.40), y = left/right (-0.25 to 0.25).
Blocks you may use (each at most once):
- cube1, cube2, cube3, cube4: cubes 0.05 wide. A cube on the table has z=0.025; on another cube z=0.075.
- plank: a beam 0.04 (x) by 0.16 (y) by 0.04 (z), long side along y. Its centre z = (top of what it rests on) + 0.02.
Rules: a block must rest on the table or fully on blocks below it; the plank must rest on two supports
at both ends (support centres 0.10 to 0.13 apart in y, same x). Keep everything inside the table area.
Return the blocks in build order (lower blocks first)."""

SCHEMA = {
  "type": "OBJECT",
  "properties": {
    "name": {"type": "STRING"},
    "blocks": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
      "block": {"type": "STRING", "enum": ["cube1", "cube2", "cube3", "cube4", "plank"]},
      "x": {"type": "NUMBER"}, "y": {"type": "NUMBER"}, "z": {"type": "NUMBER"}},
      "required": ["block", "x", "y", "z"]}},
    "say": {"type": "STRING", "description": "one short sentence for the user"}},
  "required": ["name", "blocks", "say"]}

def ask(model, request):
  body = {"systemInstruction": {"parts": [{"text": SYSTEM}]},
          "contents": [{"role": "user", "parts": [{"text": request}]}],
          "generationConfig": {"responseMimeType": "application/json", "responseSchema": SCHEMA}}
  req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": KEY})
  t = time.time()
  try:
    with urllib.request.urlopen(req, timeout=90) as r: d = json.load(r)
  except urllib.error.HTTPError as e:
    return time.time() - t, None, f"HTTP {e.code}: {json.load(e).get('error', {}).get('message', '')[:120]}"
  text = d["candidates"][0]["content"]["parts"][-1]["text"]
  return time.time() - t, json.loads(text), None

def check(plan):
  probs, placed = [], []
  for b in plan["blocks"]:
    if b["block"].startswith("cube"):
      ok = abs(b["z"] - 0.025) < 0.004 or any(p["block"].startswith("cube") and abs(p["x"] - b["x"]) < 0.01 and abs(p["y"] - b["y"]) < 0.01 and abs(p["z"] + 0.05 - b["z"]) < 0.004 for p in placed)
      if not ok: probs.append(f"{b['block']} floats or misses its support")
    else:
      sup = [p for p in placed if p["block"].startswith("cube") and abs(p["x"] - b["x"]) < 0.015 and abs(p["z"] + 0.045 - b["z"]) < 0.006 and 0.04 < abs(p["y"] - b["y"]) < 0.08]
      if len({p["y"] > b["y"] for p in sup}) < 2: probs.append("plank is not on two supports at its ends")
    placed.append(b)
  return probs

request = sys.argv[1] if len(sys.argv) > 1 else "Build a bridge."
for model in sys.argv[2:] or ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"]:
  sec, plan, err = ask(model, request)
  if err: print(f"{model:24} {sec:5.1f}s  {err}"); continue
  probs = check(plan)
  print(f"{model:24} {sec:5.1f}s  {len(plan['blocks'])} blocks  {'VALID' if not probs else 'PROBLEMS: ' + '; '.join(probs)}  | {plan['say']}")
