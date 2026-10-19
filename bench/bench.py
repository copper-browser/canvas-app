#!/usr/bin/env python3
"""A/B: Copper's embedded canvas (copper://canvas/<id>) vs Canvas App (a web tab), same probe Copper.

    bench.py setup-b             create the fixture board in Canvas App (probe world), once
    bench.py session A|B         fresh probe, one canvas tab, cold open, 3 bench-view runs, overview run, RSS
    bench.py run N               N rounds of A,B sessions -> $BENCH_RES/*.json

Probe only: COPPER_WORLD=cfix, port 4203 (never the everyday Copper on 4123). See README.md.
Environment:
  BENCH_FIXTURE  Copper's docs/fixtures/canvas-big, generated (`gen.py --scale big`) and served (`serve.sh start`)
  BENCH_COPPER   the probe's copper binary (default: copper on PATH)
  BENCH_PROBE    start/stop script for the probe (default: ./probe.sh)
  BENCH_APP      Canvas App's dist/web/index.html served with the fixture's out/big as big/ (default http://127.0.0.1:8798/)
  BENCH_RES      results directory (default results/)
  The embedded board's id goes in state.json as {"a": "<canvas id>"} (from the fixture's apply.sh report).
"""
import json
import os
import re
import subprocess
import sys
import time

import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.environ.get("BENCH_FIXTURE", os.path.join(HERE, "fixture"))
RES = os.path.join(HERE, os.environ.get("BENCH_RES", "results"))
PROBE = os.environ.get("BENCH_PROBE", os.path.join(HERE, "probe.sh"))
COPPER = os.environ.get("BENCH_COPPER") or shutil.which("copper") or "copper"
APP = os.environ.get("BENCH_APP", "http://127.0.0.1:8798/")
ENV = dict(os.environ, COPPER_WORLD="cfix", SEARCH_PROBE="cfix", SEARCH_MCP_PORT="4203")
STATE = os.path.join(HERE, "state.json")
MAN = json.load(open(os.path.join(FIX, "out/big/manifest.json")))
MEASURE_JS = open(os.path.join(FIX, "measure.js")).read()


def call(tool, args, timeout=180):
    p = subprocess.run([COPPER, "call", tool, json.dumps(args)], capture_output=True, text=True, timeout=timeout, env=ENV)
    if p.returncode:
        raise RuntimeError(f"{tool}: rc={p.returncode} {p.stderr.strip()[:300]}")
    return p.stdout


def ev(js, tab=None, timeout=180):
    args = {"function": js}
    if tab:
        args["tab"] = tab
    out = call("browser_evaluate", args, timeout)
    try:
        return json.loads(out)
    except Exception:
        return out.strip()


def state():
    return json.load(open(STATE)) if os.path.exists(STATE) else {}


def save(**kw):
    s = state()
    s.update(kw)
    json.dump(s, open(STATE, "w"), indent=1)


def healthy():
    return subprocess.run([COPPER, "health"], capture_output=True, env=ENV).returncode == 0


def restart():
    subprocess.run([PROBE, "stop"], capture_output=True)
    for _ in range(50):
        if not healthy():
            break
        time.sleep(0.2)
    time.sleep(1)
    subprocess.run([PROBE, "start"], capture_output=True)
    for _ in range(120):
        if healthy():
            break
        time.sleep(0.5)
    time.sleep(3)


def tab_ids(text):
    return re.findall(r"\{tab ([0-9a-f]+)\}", text)


def only_tab(url):
    """Open `url` in a fresh tab and close every other tab, so one canvas page runs."""
    before = tab_ids(call("browser_tabs", {"action": "list"}))
    out = call("browser_tabs", {"action": "new", "url": "about:blank"})
    mine = re.search(r"\{tab ([0-9a-f]+)\}", out).group(1)
    for t in before:
        if t != mine:
            call("browser_tabs", {"action": "close", "tab": t})
    call("browser_tabs", {"action": "select", "tab": mine, "focus": True})
    time.sleep(1)
    call("browser_navigate", {"url": url, "tab": mine})
    return mine


def tree_rss():
    """RSS (MB) of the probe: the copper process and every descendant, by kind."""
    ss = subprocess.run(["ss", "-ltnp", "sport = :4203"], capture_output=True, text=True).stdout
    m = re.search(r"pid=(\d+)", ss)
    if not m:
        return None
    root = int(m.group(1))
    ps = subprocess.run(["ps", "-eo", "pid=,ppid=,rss=,comm="], capture_output=True, text=True).stdout
    rows = [l.split(None, 3) for l in ps.strip().splitlines()]
    kids = {}
    info = {}
    for pid, ppid, rss, comm in rows:
        kids.setdefault(int(ppid), []).append(int(pid))
        info[int(pid)] = (int(rss), comm)
    out, todo = {}, [root]
    while todo:
        p = todo.pop()
        rss, comm = info.get(p, (0, "?"))
        kind = "web" if "WebProces" in comm else "network" if "Network" in comm else "app" if p == root else comm
        out[kind] = out.get(kind, 0) + rss
        todo += kids.get(p, [])
    mb = {k: round(v / 1024, 1) for k, v in out.items()}
    mb["total"] = round(sum(out.values()) / 1024, 1)
    return mb


COLD_JS = """async () => {
  const t0 = performance.now()
  while (!window.copperCanvas || !performance.getEntriesByName('canvas:painted').length) {
    if (performance.now() - t0 > 60000) return { error: 'never painted' }
    await new Promise(r => setTimeout(r, 25))
  }
  const marks = Object.fromEntries(performance.getEntriesByType('mark').filter(m => m.name.startsWith('canvas:')).map(m => [m.name, Math.round(m.startTime)]))
  const s = await window.copperCanvas.settled(10000)
  const settledAt = Math.round(performance.now())
  const r = JSON.parse(window.copperCanvas.read('{"full":false}'))
  const nav = performance.getEntriesByType('navigation')[0]
  return { marks, settledAt, settled: s.settled, pending: s.pending, count: r.count, total: r.total,
           domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
           transferKB: nav ? Math.round((nav.transferSize || nav.encodedBodySize || 0) / 1024) : null,
           heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }
}"""


def measure(tab):
    first = ev(MEASURE_JS, tab)
    if not isinstance(first, dict) or first.get("state") != "started":
        raise RuntimeError(f"measure did not start: {str(first)[:300]}")
    time.sleep(6.5)
    for _ in range(20):
        r = ev(MEASURE_JS, tab)
        if isinstance(r, dict) and r.get("state") == "done":
            return r
        time.sleep(0.5)
    raise RuntimeError("measure never finished")


def zoom(side, tab, ids):
    if side == "A":
        call("canvas_focus", {"id": state()["a"], "shapeIds": ids})
    else:
        ev(f"() => window.copperCanvas.zoomTo({json.dumps(ids)})", tab)


def overview_ids(tab):
    """Leftmost, rightmost, topmost, bottommost shapes, so zoomTo shows the whole board."""
    return ev("""() => {
      const s = JSON.parse(window.copperCanvas.read('{"full":false}')).shapes.filter(s => s.type !== 'arrow' && s.w)
      const by = f => s.reduce((a, b) => (f(b) < f(a) ? b : a)).id
      return [...new Set([by(s => s.x), by(s => -(s.x + s.w)), by(s => s.y), by(s => -(s.y + s.h))])]
    }""", tab)


def load():
    return float(open("/proc/loadavg").read().split()[0])


def session(side):
    st = state()
    url = f"copper://canvas/{st['a']}" if side == "A" else f"{APP}#/c/{st['b']}"
    restart()
    rss_idle = tree_rss()
    tab = only_tab(url)
    cold = ev(COLD_JS, tab, timeout=90)
    rec = {"side": side, "url": url, "at": time.strftime("%Y-%m-%dT%H:%M:%S"), "loadavg": [load()], "rssIdle": rss_idle, "cold": cold}
    zoom(side, tab, MAN["focusIds"])
    time.sleep(20)
    rec["rssBench"] = tree_rss()
    rec["bench"] = []
    for _ in range(3):
        rec["bench"].append(measure(tab))
        rec["loadavg"].append(load())
        time.sleep(3)
    rec["rssAfterRuns"] = tree_rss()
    zoom(side, tab, overview_ids(tab))
    time.sleep(15)
    rec["overview"] = measure(tab)
    rec["rssOverview"] = tree_rss()
    rec["loadavg"].append(load())
    os.makedirs(RES, exist_ok=True)
    path = os.path.join(RES, f"{side}-{time.strftime('%Y%m%d-%H%M%S')}.json")
    json.dump(rec, open(path, "w"), indent=1)
    b = [r["run"] for r in rec["bench"]]
    print(f"{side}: painted {cold.get('marks', {}).get('canvas:painted')} ms, settled {cold.get('settledAt')} ms; "
          f"bench p50/p95 {[r['p50'] for r in b]}/{[r['p95'] for r in b]}; overview p95 {rec['overview']['run']['p95']}; "
          f"rss {rec['rssBench']}; load {rec['loadavg']} -> {path}", flush=True)
    return rec


def setup_b():
    if not healthy():
        restart()
    out = call("browser_tabs", {"action": "new", "url": APP + "#/"})
    tab = re.search(r"\{tab ([0-9a-f]+)\}", out).group(1)
    time.sleep(2)
    batches = sorted(f for f in os.listdir(os.path.join(FIX, "out/big")) if f.startswith("ops-"))
    r = ev("""async () => {
      const h = window.__canvasApp
      const c = await h.create('Canvas big')
      h.navigate({ view: 'canvas', id: c.id })
      while (h.getState().current?.id !== c.id) await new Promise(r => setTimeout(r, 50))
      const t0 = performance.now(), per = []
      for (const f of %s) {
        const ops = await (await fetch('big/' + f)).json()
        const t = performance.now()
        const res = JSON.parse(window.copperCanvas.apply(JSON.stringify({ ops })))
        per.push({ f, ops: ops.length, applied: res.applied, errors: res.errors.length, ms: Math.round(performance.now() - t) })
      }
      await new Promise(r => setTimeout(r, 1500))
      return { id: c.id, ms: Math.round(performance.now() - t0), per, count: JSON.parse(window.copperCanvas.read('{"full":false}')).total }
    }""" % json.dumps(batches), tab, timeout=600)
    print(json.dumps({k: r[k] for k in ("id", "ms", "count")}), sum(p["applied"] for p in r["per"]), "applied,", sum(p["errors"] for p in r["per"]), "errors")
    save(b=r["id"], bApply=r)


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "setup-b":
        setup_b()
    elif cmd == "session":
        session(sys.argv[2])
    elif cmd == "run":
        for _ in range(int(sys.argv[2])):
            for side in ("A", "B"):
                session(side)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
