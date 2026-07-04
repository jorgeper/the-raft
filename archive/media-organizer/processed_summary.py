#!/usr/bin/env python3
"""
processed_summary.py -- report which source folders have been processed into a library.

USAGE
  python processed_summary.py --dest "Z:\\media-library"
  python processed_summary.py --dest "Z:\\media-library" --dest "Z:\\photos"   # several libraries

Reads each library's _organizer/ledger.csv and per-run plan.csv and prints a readable
summary: every run, its source folder, status, and where the files went. Read-only.
"""
import argparse, os, csv, datetime
from collections import defaultdict, OrderedDict

def route_of(dest):
    d=(dest or "").replace("\\","/")
    if d=="": return "duplicate"
    if d.startswith("_not-media") or d.startswith("_not-photos"): return "not-media"
    if d.startswith("_needs-review"): return "needs-review"
    if d.startswith("untouched/"):
        if "/duplicate/" in d: return "duplicate"
        if "/corrupt/" in d: return "corrupt"
        if "/corrupt-or-duplicate/" in d: return "duplicate"   # legacy combined folder
        return "untouched"
    return "placed"

ORDER=["placed","untouched","duplicate","corrupt","not-media","needs-review"]

def fmt_dt(s):
    try: return datetime.datetime.fromisoformat(s).strftime("%Y-%m-%d %H:%M")
    except Exception: return s or "?"

def run_counts(rundir):
    plan=os.path.join(rundir,"plan.csv")
    c=defaultdict(int); total=0
    if os.path.exists(plan):
        for r in csv.DictReader(open(plan,encoding="utf-8")):
            c[route_of(r.get("proposed_destination",""))]+=1; total+=1
    return total, c

def summarize_dest(dest):
    org=os.path.join(dest,"_organizer"); ledger=os.path.join(org,"ledger.csv")
    print("="*72)
    print(f"LIBRARY: {dest}")
    if not os.path.exists(ledger):
        print("  (no runs yet — no _organizer\\ledger.csv found)\n"); return None
    rows=list(csv.DictReader(open(ledger,encoding="utf-8")))
    agg=defaultdict(int); sources=OrderedDict(); grand_total=0
    for r in rows:
        rid=r.get("run_id",""); total,c=run_counts(os.path.join(org,"runs",rid))
        if total==0: total=int(r.get("total_files") or 0)
        grand_total+=total
        print(f"\n  RUN {rid}   [{r.get('phase','?')}]   {fmt_dt(r.get('started_at',''))}")
        print(f"    source : {r.get('source','?')}")
        print(f"    copied : {r.get('copied_count','?')} of {total} files")
        print("    routing: "+" | ".join(f"{k} {c.get(k,0)}" for k in ORDER))
        for k in ORDER: agg[k]+=c.get(k,0)
        sources[r.get('source','?')]=True
    print("\n  "+"-"*40)
    print(f"  TOTAL: {len(rows)} run(s), {len(sources)} source folder(s), {grand_total} files scanned")
    print("  "+" | ".join(f"{k} {agg[k]}" for k in ORDER))
    print()
    return dict(runs=len(rows),sources=list(sources),total=grand_total,agg=dict(agg))

def main():
    ap=argparse.ArgumentParser(description="Summary of source folders processed into a library.")
    ap.add_argument("--dest",required=True,action="append",help="library destination folder (repeatable)")
    a=ap.parse_args()
    results=[summarize_dest(os.path.abspath(d)) for d in a.dest]
    if len([r for r in results if r])>1:
        allsrc=set(); tot=0
        for r in results:
            if r: allsrc.update(r["sources"]); tot+=r["total"]
        print("="*72)
        print(f"GRAND TOTAL across {len(a.dest)} libraries: {len(allsrc)} unique source folders, {tot} files")

if __name__=="__main__":
    main()
