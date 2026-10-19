#!/usr/bin/env python3
"""Medians per side from bench.py's session files: summary.py RESULTS_DIR [RESULTS_DIR…]"""
import glob
import json
import os
import statistics as st
import sys


def med(xs):
    return round(st.median(xs), 1) if xs else None


def summarise(rs):
    c = [r["cold"] for r in rs]
    runs = [run["run"] for r in rs for run in r["bench"]]
    ov = [r["overview"]["run"] for r in rs]
    return {
        "sessions": len(rs),
        "readyToInitMs": med([x["marks"]["canvas:init"] - x["marks"]["canvas:ready"] for x in c]),
        "paintedMs": med([x["marks"]["canvas:painted"] for x in c]),
        "settledMs": med([x["settledAt"] for x in c]),
        "benchP50Ms": med([x["p50"] for x in runs]),
        "benchP95Ms": med([x["p95"] for x in runs]),
        "benchFps": med([x["fps"] for x in runs]),
        "overviewP50Ms": med([x["p50"] for x in ov]),
        "overviewP95Ms": med([x["p95"] for x in ov]),
        "webRssMB": med([r["rssAfterRuns"]["web"] for r in rs if r["rssAfterRuns"].get("web")]),
        "totalRssMB": med([r["rssAfterRuns"]["total"] for r in rs]),
        "loadavg": med([x for r in rs for x in r["loadavg"]]),
    }


def main():
    out = {}
    for d in sys.argv[1:]:
        for side in ("A", "B"):
            rs = [json.load(open(f)) for f in sorted(glob.glob(os.path.join(d, f"{side}-*.json")))]
            if rs:
                out[f"{os.path.basename(d.rstrip('/'))}/{side}"] = summarise(rs)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
