# Embedded canvas vs Canvas App, inside Copper

Does the canvas run as well as a plain web page (Canvas App, `dist/web/index.html`, with its own
in-tab host) as it does embedded in Copper (`copper://canvas/<id>`, Copper's native host)? If so,
Copper can stop carrying its own copy of the page and use this repository's.

**Short answer (2026-10-19): yes.** On the same 1,500-shape board, in the same Copper, Canvas App
renders identically, opens a little faster, and its web process uses about 300 MB less memory.

## Setup

- **Browser**: one probe Copper for Linux 0.2.0 (the release whose embedded `canvas.html` is
  byte-identical to Copper `fork` at the split), on the Exowatt cloud VM (aarch64, 16 cores).
  It ran in its own world (`COPPER_WORLD=cfix`, MCP :4203), on a headless weston at 1440×900.
  Rendering is pixman, i.e. software, so absolute frame times are slow. Only the A-vs-B
  comparison means anything.
  WebKit's sandbox is off in the probe for both sides (`probe.sh` says why).
- **A, embedded**: `copper://canvas/<id>`, the page Copper ships, with Copper's host. Updates go
  to its file log, the page is initialised over the bridge, and Copper reports frames and posters.
- **B, Canvas App**: an ordinary tab on `http://127.0.0.1:8798/#/c/<id>`, serving this repo's web
  build (canvas-app#1). The tab is its own host: IndexedDB log, `copperCanvas.init` in-page.
- **Board**: Copper's `docs/fixtures/canvas-big` at `--scale big` (seed 20261016), identical on
  both sides. It has 1,500 shapes: 40 slide frames, 40 live web frames, 150 data-URL images,
  900 stickies and texts, 60 checklists, 10 timelines and 250 arrows, plus 40 comment threads.
  That is ~15 MB of document.
  A received it through `canvas_apply` (1,593 ops in 1.95 s via the CLI). B received it through
  `copperCanvas.apply` in the page (1,593 ops in 0.62 s of apply time, not counting fetching
  the batches; no IPC).
- **Session** (`bench.py session A|B`):
  1. restart the probe, then close every tab except a fresh one, so one canvas page runs;
  2. cold-open the canvas (the page's own `canvas:*` marks and `settled()`);
  3. `zoomTo` the fixture's bench view (3 live frames + a slide, z ≈ 0.44), wait 20 s;
  4. three runs of the fixture's `measure.js` (a scripted 5 s pan + 4× zoom out and back, by
     synthetic wheel events, rAF-to-rAF frame times);
  5. zoom to the whole board, wait 15 s, one more run;
  6. RSS of the probe's processes (`ps`, by kind) after the runs.
- **Order**: sessions alternate A, B, A, B… so drift in the VM's load (other agents' builds)
  falls on both sides. The first pair ran at load ~15 and is left out of the medians below. All
  raw sessions are in `results/2026-10-19/` with their load averages; `summary.py` recomputes
  the table.

## Results

Medians. Before-fix: A n=4, B n=4. After-fix: A n=2, B n=2. Load 2–6.

| | A embedded | B Canvas App, as first shipped | B Canvas App, fixed (b22a7c4) |
|---|---:|---:|---:|
| page ready → host's `init` | 93–95 ms | 326 ms | **39 ms** |
| first paint (`canvas:painted`) | 770–772 ms | 1,007 ms | **729 ms** |
| settled (pictures + frames in view) | 2,558–2,580 ms | 2,721 ms | 2,493 ms |
| bench view, pan/zoom frame p50 | 115–117 ms | 116 ms | 111 ms |
| bench view, frame p95 | 1,152–1,161 ms | 1,167 ms | 1,143 ms |
| overview, frame p50 | 16 ms | 16 ms | 16 ms |
| WebKit web process RSS | 1,663–1,701 MB | 1,359 MB | **1,401 MB** |
| probe total RSS (app + web + network) | 2,034–2,084 MB | 1,759 MB | 1,779 MB |

(p95 equals the max here because a 5 s run at ~3 fps has about 15 frames.)

- **Rendering is the same page.** Frame times are equal within noise on both views. That is
  expected: the board's work (culling, LOD, thumbnails, frame planning) is all in the page, and
  both sides run the same page.
- **Opening was slower, then faster.** As first shipped, Canvas App spent 330 ms from `ready` to
  `init` re-merging a many-row IndexedDB log. Copper compacts its log at 500 entries *or 2 MB*;
  the web host only counted entries, so a 15 MB board never compacted (feads #forca-lar). With
  the same rule, plus a compaction right after opening a multi-row log, `init` comes 39 ms after
  `ready`. That beats Copper's 95 ms, which reads its file log and hands the state over the bridge.
- **Memory: Canvas App is ~300 MB lighter.** The board is the same and so are the mounted shapes
  and the DOM (187 shapes, ~1,900 nodes on the bench view). The extra is in Copper's embedded
  path.
  - Not yet attributed. Two plausible causes: the init state (~15 MB of base64) is passed as a
    JavaScript source string through the bridge, and Copper keeps live-frame posters (JPEGs,
    ≤ 40 MB cache) and per-frame report scripts.
  - Worth measuring before deciding how much of Copper's host to keep.

### What this does not show

- No GPU. Under real compositing both sides are much faster, but the page is the same, so the
  rendering comparison should hold. The open-time and memory numbers should be re-checked on a
  Mac.
- Canvas App does not do what only Copper's host can: MCP `canvas_*` tools, Copper Cloud over
  its pinned socket, posters of live frames, and frame load reports. In B, frames that never
  report keep their live iframe or card. Neither side had a live iframe mounted at the measured
  instants (`liveIframes: 0`), so this did not skew the frame numbers.

## Recommendation

1. **Make this repository the only home of the page.** Copper (macOS) vendors `dist/canvas.html`
   from a pinned canvas-app ref instead of building `Canvas/`. Copper for Linux's
   `sync-canvas-bundle.sh` takes it from canvas-app instead of a Mac checkout, and Windows
   follows Linux. Canvas work lands here once, for every host and for every browser.
2. **Keep Copper's native host for now.** It provides the MCP tools, the pinned Copper Cloud
   socket, posters and frame reports, and none of it costs frame time. Look at its ~300 MB first.
3. **Later:** canvas-cloud (feads #forca-eun) serves Canvas App itself (`web_root`). Copper could
   open a server's canvases in that app, and keep the native host only for local canvases and
   agent tools.

## Reproduce

```sh
# Copper's fixture, generated and served (pages on :8765)
cp -r <Copper>/docs/fixtures/canvas-big fixture && (cd fixture && python3 gen.py --scale big && ./serve.sh start)
# a probe Copper (never the everyday one on :4123)
export BENCH_COPPER=/path/to/copper COPPER_WORLD=cfix SEARCH_PROBE=cfix SEARCH_MCP_PORT=4203 COPPER_BIN=$BENCH_COPPER
./probe.sh start
(cd fixture && ./apply.sh "Canvas big" big)             # A's board; its id → state.json {"a": "<id>"}
mkdir -p app && cp ../dist/web/index.html app/ && ln -s "$PWD/fixture/out/big" app/big
python3 -m http.server 8798 --bind 127.0.0.1 --directory app &
BENCH_FIXTURE=$PWD/fixture python3 bench.py setup-b     # B's board, through copperCanvas.apply
BENCH_FIXTURE=$PWD/fixture python3 bench.py run 3       # A, B, A, B, A, B → results/
python3 summary.py results
./probe.sh stop
```
