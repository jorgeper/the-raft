#!/usr/bin/env python3
"""
library_fixer-fable.py -- scan & repair a library built by media_organizer.py / -fable.

WHY do files named 2016-... sit inside a 2014/ folder?
  The v5 organizer grouped every file of a single-level source folder ("event") under the
  EARLIEST date found in that folder, while each file kept its OWN date in its filename.
  So a source folder mixing years -- or containing one mis-dated file (bad modified-time)
  -- parks 2016-named files under 2014/. This tool finds those strays and moves them to
  the year/month their filename says. (media_organizer-fable.py no longer creates these.)

WHAT IT CHECKS -- only inside YYYY/MM - Month/ trees.
  _organizer/, untouched/, _needs-review/, _not-media/ are never touched.
  1. date-mismatch : a file named YYYY-MM-DD-... under a different year/month.
                     Inside an event folder it is moved only if more than --tolerance-days
                     (default 31) from the event folder's date, so multi-day trips and
                     new-year's-eve events stay together.
  2. empty-slug    : files like 2020-05-08-.jpg / 2020-05-08--01.jpg (produced by v5 for
                     non-Latin names) -> renamed to the numbered scheme 2020-05-08-001.jpg.
  3. dash-dir      : event folders like 2014-02-26- (empty slug) -> renamed 2014-02-26-event.
  Files that don't follow the YYYY-MM-DD-... naming at all are reported (no action).

USAGE
  python library_fixer-fable.py scan   --dest "DST"                 # report only; writes fixplan.csv
  python library_fixer-fable.py fix    --dest "DST"                 # apply moves/renames (all logged)
  python library_fixer-fable.py revert --dest "DST" [--fix-run ID]  # undo a fix run from its log
Options:
  --tolerance-days N   keep files within N days of their event folder's date (default 31)
  --prune-empty        after fixing, remove directories the moves left empty (fix only)

SAFETY
  Only moves/renames INSIDE the destination; never overwrites (collisions get a numeric
  suffix); never deletes a file; every change is appended to
  _organizer/fixes/<id>/fixlog.csv so `revert` can undo the run.
"""
import argparse, os, re, sys, csv, shutil, datetime

# never let a non-ASCII filename crash progress output on a cp1252 Windows console
try: sys.stdout.reconfigure(errors="replace"); sys.stderr.reconfigure(errors="replace")
except Exception: pass

MONTHS=["","January","February","March","April","May","June","July","August","September","October","November","December"]
DATE_PREFIX=re.compile(r"^(\d{4})-(\d{2})-(\d{2})-")
EMPTY_SLUG=re.compile(r"^\d{4}-\d{2}-\d{2}-(?:-\d{2})?\.[A-Za-z0-9]+$")

def norm(p): return p.replace("\\","/")
def month_dir(y,m): return f"{y}/{m:02d} - {MONTHS[m]}"

def prefix_date(name):
    m=DATE_PREFIX.match(name)
    if not m: return None
    y,mo,d=map(int,m.groups())
    try: return datetime.date(y,mo,d)
    except ValueError: return None

class Namer:
    """Tracks names per destination dir (existing on disk + planned) to avoid collisions."""
    def __init__(self,DST): self.DST=DST; self.cache={}
    def names(self,reldir):
        if reldir not in self.cache:
            p=os.path.join(self.DST,reldir)
            self.cache[reldir]={n.lower() for n in os.listdir(p)} if os.path.isdir(p) else set()
        return self.cache[reldir]
    def claim(self,reldir,fname):
        names=self.names(reldir)
        if fname.lower() not in names:
            names.add(fname.lower()); return fname
        stem,ext=os.path.splitext(fname); k=1
        while f"{stem}-{k:02d}{ext}".lower() in names: k+=1
        cand=f"{stem}-{k:02d}{ext}"; names.add(cand.lower()); return cand
    def next_numbered(self,reldir,datestr,ext):
        names=self.names(reldir); mx=0
        pat=re.compile(re.escape(datestr)+r"-(\d{3})\.")
        for n in names:
            m=pat.match(n)
            if m: mx=max(mx,int(m.group(1)))
        cand=f"{datestr}-{mx+1:03d}{ext}"; names.add(cand.lower()); return cand

def collect(DST, tol):
    """Walk YYYY/MM - Month trees and build the list of planned actions + report rows."""
    actions=[]   # dict(type, from, to)  -- to computed later for renames needing Namer
    report=[]    # dict(type, path, note)  -- report-only rows
    namer=Namer(DST)
    checked=0; kept=0
    years=[d for d in sorted(os.listdir(DST)) if re.fullmatch(r"\d{4}",d) and os.path.isdir(os.path.join(DST,d))]
    def handle_file(reldir, fname, yy, mo, evdate):
        nonlocal checked, kept
        checked+=1
        fdate=prefix_date(fname)
        if fdate is None:
            report.append(dict(type="non-conforming-name", path=f"{reldir}/{fname}", note="no YYYY-MM-DD- prefix; left alone"))
            return
        target_dir=reldir
        note=""
        if (fdate.year,fdate.month)!=(yy,mo):
            if evdate is not None and abs((fdate-evdate).days)<=tol:
                kept+=1
                report.append(dict(type="kept-event-spillover", path=f"{reldir}/{fname}",
                                   note=f"{abs((fdate-evdate).days)}d from event date; within tolerance {tol}d"))
            else:
                target_dir=month_dir(fdate.year,fdate.month)
                note=f"filed under {yy}/{mo:02d}, filename says {fdate.year}-{fdate.month:02d}"
                if evdate is not None: note+=f" (was in event folder, {abs((fdate-evdate).days)}d from its date)"
        target_name=fname
        if EMPTY_SLUG.fullmatch(fname):
            ds=f"{fdate.year}-{fdate.month:02d}-{fdate.day:02d}"; ext=os.path.splitext(fname)[1]
            target_name=namer.next_numbered(target_dir,ds,ext)
            note=(note+"; " if note else "")+"empty-slug name -> numbered"
        elif target_dir!=reldir:
            target_name=namer.claim(target_dir,fname)
            if target_name!=fname: note+=f"; renamed to avoid collision"
        if target_dir!=reldir or target_name!=fname:
            typ="date-mismatch" if target_dir!=reldir else "empty-slug"
            actions.append(dict(type=typ, src=f"{reldir}/{fname}", dst=f"{target_dir}/{target_name}", note=note))
    for ydir in years:
        yy=int(ydir); ypath=os.path.join(DST,ydir)
        for mdir in sorted(os.listdir(ypath)):
            mm=re.match(r"^(\d{2}) - ",mdir); mpath=os.path.join(ypath,mdir)
            if not mm or not os.path.isdir(mpath): continue
            mo=int(mm.group(1))
            if not (1<=mo<=12):
                report.append(dict(type="odd-month-dir", path=f"{ydir}/{mdir}", note="month outside 01-12; left alone")); continue
            reldir=f"{ydir}/{mdir}"
            for entry in sorted(os.listdir(mpath)):
                epath=os.path.join(mpath,entry)
                if os.path.isfile(epath):
                    handle_file(reldir, entry, yy, mo, None)
                elif os.path.isdir(epath):
                    evdate=prefix_date(entry)      # event dirs are YYYY-MM-DD-slug (or YYYY-MM-DD-)
                    evrel=f"{reldir}/{entry}"
                    for sub in sorted(os.listdir(epath)):
                        spath=os.path.join(epath,sub)
                        if os.path.isfile(spath): handle_file(evrel, sub, yy, mo, evdate)
                        else: report.append(dict(type="unexpected-depth", path=f"{evrel}/{sub}", note="dir below event level; left alone"))
                    if entry.endswith("-"):        # dash-dir: v5 empty event slug
                        newname=namer.claim(reldir, entry+"event")
                        actions.append(dict(type="dash-dir", src=evrel, dst=f"{reldir}/{newname}", note="empty event slug -> 'event'"))
    return actions, report, checked, kept

def write_plan(fixdir, actions, report):
    os.makedirs(fixdir,exist_ok=True)
    plan=os.path.join(fixdir,"fixplan.csv")
    with open(plan,"w",newline="",encoding="utf-8") as fh:
        w=csv.writer(fh); w.writerow(["type","from","to","note"])
        for a in actions: w.writerow([a["type"],a["src"],a["dst"],a["note"]])
        for r in report: w.writerow([r["type"],r["path"],"",r["note"]])
    return plan

def print_summary(actions, report, checked, kept, tol):
    by={}
    for a in actions: by[a["type"]]=by.get(a["type"],0)+1
    print(f"\nchecked {checked} files in YYYY/MM trees")
    print(f"  date-mismatch to move : {by.get('date-mismatch',0)}")
    print(f"  kept (event spillover within {tol}d): {kept}")
    print(f"  empty-slug renames    : {by.get('empty-slug',0)}")
    print(f"  dash-dir renames      : {by.get('dash-dir',0)}")
    ro={}
    for r in report:
        if r["type"]!="kept-event-spillover": ro[r["type"]]=ro.get(r["type"],0)+1
    for t,c in sorted(ro.items()): print(f"  report-only {t}: {c}")
    moves=[a for a in actions if a["type"]=="date-mismatch"]
    if moves:
        print("\n  sample moves:")
        for a in moves[:12]: print(f"    {a['src']}  ->  {a['dst']}")
        if len(moves)>12: print(f"    ... and {len(moves)-12} more (see fixplan.csv)")

def cmd_scan(args):
    DST=os.path.abspath(args.dest)
    if not os.path.isdir(DST): sys.exit(f"destination not found: {DST}")
    actions,report,checked,kept=collect(DST,args.tolerance_days)
    fid=datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    plan=write_plan(os.path.join(DST,"_organizer","fixes",fid),actions,report)
    print_summary(actions,report,checked,kept,args.tolerance_days)
    print(f"\nplan (nothing changed): {plan}")
    if actions: print(f"apply with:  python {os.path.basename(__file__)} fix --dest \"{DST}\" --tolerance-days {args.tolerance_days}")

def cmd_fix(args):
    DST=os.path.abspath(args.dest)
    if not os.path.isdir(DST): sys.exit(f"destination not found: {DST}")
    actions,report,checked,kept=collect(DST,args.tolerance_days)
    fid=datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    fixdir=os.path.join(DST,"_organizer","fixes",fid)
    write_plan(fixdir,actions,report)
    print_summary(actions,report,checked,kept,args.tolerance_days)
    if not actions: print("\nnothing to fix."); return
    logpath=os.path.join(fixdir,"fixlog.csv"); applied=0; errors=0
    emptied=set()
    with open(logpath,"w",newline="",encoding="utf-8") as fh:
        w=csv.writer(fh); w.writerow(["seq","type","from","to","status"])
        # files first, then dir renames (a dir rename would invalidate file paths under it)
        ordered=[a for a in actions if a["type"]!="dash-dir"]+[a for a in actions if a["type"]=="dash-dir"]
        for i,a in enumerate(ordered):
            src=os.path.join(DST,a["src"]); dst=os.path.join(DST,a["dst"])
            try:
                if not os.path.exists(src): raise OSError("source vanished")
                if os.path.exists(dst): raise OSError("target already exists")   # never overwrite
                os.makedirs(os.path.dirname(dst),exist_ok=True)
                shutil.move(src,dst); applied+=1
                emptied.add(os.path.dirname(src))
                w.writerow([i,a["type"],a["src"],a["dst"],"OK"])
            except OSError as e:
                errors+=1; w.writerow([i,a["type"],a["src"],a["dst"],f"ERROR: {e}"])
    print(f"\napplied {applied} change(s), {errors} error(s)   log: {logpath}")
    if args.prune_empty:
        pruned=0
        for d in sorted(emptied,key=lambda p:-len(p)):
            try:
                if os.path.isdir(d) and not os.listdir(d): os.rmdir(d); pruned+=1
            except OSError: pass
        print(f"pruned {pruned} empty dir(s)")
    else:
        left=[d for d in emptied if os.path.isdir(d) and not os.listdir(d)]
        if left: print(f"note: {len(left)} dir(s) are now empty (rerun fix with --prune-empty to remove)")
    print(f"undo with:  python {os.path.basename(__file__)} revert --dest \"{DST}\" --fix-run {fid}")

def cmd_revert(args):
    DST=os.path.abspath(args.dest); fixes=os.path.join(DST,"_organizer","fixes")
    if not os.path.isdir(fixes): sys.exit("no fixes recorded under _organizer/fixes")
    fid=args.fix_run
    if not fid:
        cands=[d for d in sorted(os.listdir(fixes)) if os.path.exists(os.path.join(fixes,d,"fixlog.csv"))]
        if not cands: sys.exit("no applied fix runs found (scan-only runs have no fixlog.csv)")
        fid=cands[-1]
    logpath=os.path.join(fixes,fid,"fixlog.csv")
    if not os.path.exists(logpath): sys.exit(f"no fixlog.csv for fix run {fid}")
    rows=[r for r in csv.DictReader(open(logpath,encoding="utf-8")) if r["status"]=="OK"]
    undone=0; errors=0
    for r in reversed(rows):                      # reverse order: dir renames undone first
        src=os.path.join(DST,r["to"]); dst=os.path.join(DST,r["from"])
        try:
            if not os.path.exists(src): raise OSError("moved file no longer at logged location")
            if os.path.exists(dst): raise OSError("original location now occupied")
            os.makedirs(os.path.dirname(dst),exist_ok=True)
            shutil.move(src,dst); undone+=1
        except OSError as e:
            errors+=1; print(f"  cannot revert {r['to']} -> {r['from']}: {e}")
    print(f"reverted {undone}/{len(rows)} change(s) from fix run {fid}" + (f", {errors} error(s)" if errors else ""))

def main():
    ap=argparse.ArgumentParser(description="Scan & repair a media_organizer library (wrong-year strays, empty-slug names).")
    sub=ap.add_subparsers(dest="cmd",required=True)
    for name in ("scan","fix"):
        sp=sub.add_parser(name); sp.add_argument("--dest",required=True)
        sp.add_argument("--tolerance-days",dest="tolerance_days",type=int,default=31,
                        help="keep files within N days of their event folder's date (default 31)")
        if name=="fix": sp.add_argument("--prune-empty",dest="prune_empty",action="store_true")
    rv=sub.add_parser("revert"); rv.add_argument("--dest",required=True); rv.add_argument("--fix-run",dest="fix_run",default=None)
    a=ap.parse_args()
    {"scan":cmd_scan,"fix":cmd_fix,"revert":cmd_revert}[a.cmd](a)

if __name__=="__main__":
    main()
