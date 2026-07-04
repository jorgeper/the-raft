#!/usr/bin/env python3
"""
media_organizer-fable.py  --  deterministic media (photo/video/audio) organizer.  v6 "fable"

Drop-in successor to media_organizer.py. Same flow (scan -> date -> plan -> review -> execute
-> resume-safe), with these fixes/improvements over v5:

  - execute survives per-file copy errors: a locked/vanished/unreadable file is logged FAILED
    in copied.log and the run continues (v5 crashed and could never finish past it)
  - name-collision suffixes are re-checked, so two files can no longer be planned onto the
    same destination path (v5 could silently overwrite one with the other)
  - verify report now lists MISSING source files with their paths (v5 said "see report" but
    never wrote them)
  - empty slugs fall back to the numbered scheme: fully non-Latin names no longer become
    "2020-05-08-.jpg"; accents are transliterated (cumpleaños -> cumpleanos)
  - event folders only claim files within --event-span-days (default 31) of the folder's
    typical date; far-off strays (wrong-year files) are placed in their own year/month
    (v5 parked the whole folder under the EARLIEST date, mixing years)
  - incremental skip: library.md5 now records hash<TAB>destination, so re-runs recognize
    content even when numbered filenames shift (old plain-hash manifests still read fine)
  - execute progress prints each NEW destination folder as it is first created
  - PIL images are closed after EXIF read (no fd leak); HEIC/HEIF EXIF works when pillow-heif
    is installed; png/webp EXIF attempted; ffprobe check is lazy (not at import)
  - guards against source/destination overlap
  - --min-year (default 1995) replaces the hard-coded plausibility floor
  - Google Takeout ".supplemental-metadata.json" sidecars; timezone-safe timestamp parsing

USAGE
  python media_organizer-fable.py run     --source "SRC" --dest "DST"   # ONE STEP: plan + copy + verify
  python media_organizer-fable.py plan    --source "SRC" --dest "DST"   # dry run only
  python media_organizer-fable.py execute --dest "DST"                  # copy per plan + verify
  python media_organizer-fable.py resume  --dest "DST"                  # finish an interrupted copy
  python media_organizer-fable.py status  --dest "DST"                  # list runs
  python media_organizer-fable.py verify  --source "SRC" --dest "DST"   # content diff

ROUTING (priority order, per source file) -- unchanged from v5
  1. media & (zero-byte/unreadable)   -> untouched/<parent>/corrupt/<name>
  2. media & duplicate of a kept file -> untouched/<parent>/duplicate/<name>
  3. nested >1 folder deep in source  -> untouched/<same source path>
  4. not media (<=1 folder deep)      -> _not-media/<path>
  5. media, <=1 deep, has a date      -> YYYY/MM - Month/[event/]YYYY-MM-DD-slug.ext
  6. media, <=1 deep, no date         -> _needs-review/<path>
  Every file is copied somewhere; nothing is skipped, nothing is deleted, bytes never altered.

DEPENDENCIES: Python 3.8+, Pillow (image EXIF), pillow-heif (optional, HEIC dates),
  ffprobe/ffmpeg on PATH (video/audio dates). Missing deps -> filename/mtime fallback.
"""
import argparse, os, re, sys, csv, json, hashlib, shutil, subprocess, datetime, random, unicodedata
from collections import defaultdict

# never let a non-ASCII filename crash progress output on a cp1252 Windows console
try: sys.stdout.reconfigure(errors="replace"); sys.stderr.reconfigure(errors="replace")
except Exception: pass

IMAGE_EXT  = {"jpg","jpeg","png","gif","bmp","tif","tiff","heic","heif","webp"}
DESIGN_EXT = {"psd","psp","eps","ico"}
RAW_EXT    = {"cr2","cr3","nef","arw","dng","raf","orf","rw2","pef","srw"}
VIDEO_EXT  = {"mov","mp4","m4v","avi","3gp","mkv","wmv","asf","mts","m2ts","mpg","mpeg","flv","webm","ogv"}
AUDIO_EXT  = {"m4a","mp3","wav","aac","ogg","flac","wma","m4b","aiff","opus"}
MEDIA_EXT  = IMAGE_EXT | DESIGN_EXT | RAW_EXT | VIDEO_EXT | AUDIO_EXT
EXIF_EXT   = {"jpg","jpeg","tif","tiff","png","webp"}
PROBE_EXT  = VIDEO_EXT | AUDIO_EXT
MONTHS = ["","January","February","March","April","May","June","July","August","September","October","November","December"]
MONTHIDX = {"jan":1,"feb":2,"mar":3,"apr":4,"may":5,"jun":6,"jul":7,"aug":8,"sep":9,"sept":9,"oct":10,"nov":11,"dec":12}
GENERIC = {"new folder","camera roll","dcim","export","misc","photos","images","pictures",
           "original size","social media","zip","video","videos"}
GENERIC_RE = re.compile(r"^\d{2,3}[a-z]{4,}$")
CAMPREFIX = ["dscf","dscn","dscm","dsc","dcp","img","pxl","vid","mvi","gopr","pict","picture","image","photo","map","p"]

MIN_YEAR   = 1995     # overridable with --min-year
EVENT_SPAN = 31       # days; overridable with --event-span-days

try:
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    HAVE_PIL = True
except Exception:
    HAVE_PIL = False
try:
    import pillow_heif; pillow_heif.register_heif_opener(); HAVE_HEIF = True
except Exception:
    HAVE_HEIF = False
if HAVE_PIL and HAVE_HEIF:
    EXIF_EXT |= {"heic","heif"}

_FFPROBE = None
def have_ffprobe():
    """Lazy: only probes the first time it's actually needed (v5 ran it at import)."""
    global _FFPROBE
    if _FFPROBE is None:
        try:
            subprocess.run(["ffprobe","-version"], capture_output=True, check=True); _FFPROBE=True
        except Exception:
            _FFPROBE=False
    return _FFPROBE

# ---- optional pretty output (rich). Falls back to plain text if not installed. ----
import contextlib
try:
    from rich.console import Console
    from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn, MofNCompleteColumn, TimeRemainingColumn
    _console=Console(); HAVE_RICH=True
except Exception:
    _console=None; HAVE_RICH=False
if os.environ.get("MO_NO_RICH"): HAVE_RICH=False

def _info(msg):
    if HAVE_RICH: _console.print(msg)
    else: print(re.sub(r"\[/?[a-z ]*\]","",msg))

@contextlib.contextmanager
def status(msg):
    if HAVE_RICH:
        with _console.status(msg): yield
    else:
        print(msg, flush=True); yield

def _short(p, n=48):
    p=p if p not in (".","") else "(root)"
    return p if len(p)<=n else "..."+p[-(n-1):]

def track(seq, phase, folder_of, log_folders=False):
    seq=list(seq); total=len(seq); seen=set(); tf=0
    for it in seq:
        fo=folder_of(it)
        if fo not in seen: seen.add(fo); tf+=1
    if HAVE_RICH and total:
        cols=[SpinnerColumn(), TextColumn("[bold]{task.description}"), BarColumn(),
              MofNCompleteColumn(), TextColumn("[cyan]{task.fields[fd]}/%d folders"%tf),
              TextColumn("[dim]{task.fields[folder]}"), TimeRemainingColumn()]
        with Progress(*cols, console=_console) as pr:
            t=pr.add_task(phase, total=total, folder="", fd=0); cur=None; fd=0
            for it in seq:
                fo=folder_of(it)
                if fo!=cur:
                    if cur is not None:
                        fd+=1
                        if log_folders: pr.console.print(f"  [green]done[/] {_short(cur)}")
                    cur=fo; pr.update(t, folder=_short(fo), fd=fd)
                yield it; pr.advance(t)
            if cur is not None and log_folders: pr.console.print(f"  [green]done[/] {_short(cur)}")
            pr.update(t, fd=tf, folder="")
    else:
        cur=None; fd=0
        for it in seq:
            fo=folder_of(it)
            if fo!=cur:
                if cur is not None: fd+=1
                cur=fo; print(f"[{phase}] {fd}/{tf} folders - now: {_short(fo)}", flush=True)
            yield it
        print(f"[{phase}] complete: {total} files, {tf} folders", flush=True)


def norm(p): return p.replace("\\","/")
def depth(rel): return norm(rel).strip("/").count("/")          # 0 = root file, 1 = one folder deep
def single_level(folder): return folder not in (".","") and "/" not in norm(folder)

def check_overlap(SRC, DST):
    """Refuse to run when one tree contains the other (v5 would scan/copy into itself)."""
    try: common=os.path.commonpath([SRC,DST])
    except ValueError: return              # different drives -> cannot overlap
    if os.path.normcase(common) in (os.path.normcase(SRC), os.path.normcase(DST)):
        sys.exit(f"source and destination overlap:\n  {SRC}\n  {DST}\nChoose a destination outside the source tree (and vice versa).")

def md5(path, chunk=1<<20):
    h=hashlib.md5()
    with open(path,"rb") as f:
        for b in iter(lambda: f.read(chunk), b""): h.update(b)
    return h.hexdigest()
def slugify(text):
    # transliterate accents (cumpleaños -> cumplea~nos -> cumpleanos) before stripping
    s=unicodedata.normalize("NFKD",text).encode("ascii","ignore").decode("ascii")
    s=s.lower(); s=re.sub(r"\(\d+\)$","",s).strip(); s=re.sub(r"[_\s]*copy$","",s).strip()
    return re.sub(r"[^a-z0-9]+","-",s).strip("-")
def make_slug(base):
    raw=re.sub(r"\s*\(\d+\)$","",base); low=raw.lower(); st=low
    for p in CAMPREFIX:
        m=re.match(r"^"+p+r"[-_]?(\d.*)$",low)
        if m: st=m.group(1); break
    if re.fullmatch(r"[\d\-_]+",st): return None
    return slugify(raw) or None            # empty slug (non-Latin name) -> numbered scheme
def plausible(y,mo=1,d=1):
    try: dt=datetime.date(y,mo,d)
    except ValueError: return False
    return datetime.date(MIN_YEAR,1,1)<=dt<=datetime.date.today()

def exif_date(path,ext):
    if not HAVE_PIL or ext not in EXIF_EXT: return None
    vals=[]
    try:
        with Image.open(path) as im:       # context manager: v5 leaked the file handle
            try:
                ex=im.getexif(); ifd=ex.get_ifd(0x8769)
                vals=[ifd.get(36867),ifd.get(36868),ex.get(306)]
            except Exception:              # very old Pillow: fall back to legacy API
                ex=im._getexif() or {}
                vals=[ex.get(36867),ex.get(36868),ex.get(306)]
    except Exception:
        return None
    for v in vals:
        if v:
            m=re.match(r"(\d{4})[:\-](\d{2})[:\-](\d{2})",str(v).strip())
            if m:
                y,mo,d=map(int,m.groups())
                if plausible(y,mo,d): return datetime.date(y,mo,d)
    return None
def probe_date(path,ext):
    if ext not in PROBE_EXT or not have_ffprobe(): return None
    try:
        out=subprocess.run(["ffprobe","-v","quiet","-print_format","json","-show_entries","format_tags",path],
                           capture_output=True,text=True).stdout
        tags={k.lower():v for k,v in ((json.loads(out).get("format",{}) or {}).get("tags",{}) or {}).items()}
        for key in ("com.apple.quicktime.creationdate","date","creation_time"):
            v=tags.get(key)
            if v:
                m=re.match(r"(\d{4})[-:](\d{2})[-:](\d{2})",str(v).strip())
                if m:
                    y,mo,d=map(int,m.groups())
                    if plausible(y,mo,d): return datetime.date(y,mo,d)
    except Exception: return None
def filename_date(name):
    m=re.search(r"(19|20)\d{2}[-_]?(0[1-9]|1[0-2])[-_]?(0[1-9]|[12]\d|3[01])",name)
    if m:
        s=re.sub(r"[-_]","",m.group(0)); y,mo,d=int(s[:4]),int(s[4:6]),int(s[6:8])
        if plausible(y,mo,d): return datetime.date(y,mo,d)
def sidecar_date(full):
    for cand in (full+".json", full+".supplemental-metadata.json", os.path.splitext(full)[0]+".json"):
        if os.path.exists(cand):
            try:
                j=json.load(open(cand,encoding="utf-8")); pt=j.get("photoTakenTime") or j.get("creationTime")
                if pt and pt.get("timestamp"):
                    dt=datetime.datetime.fromtimestamp(int(pt["timestamp"]),datetime.timezone.utc)
                    if plausible(dt.year,dt.month,dt.day): return dt.date()
            except Exception: pass
    xmp=os.path.splitext(full)[0]+".xmp"
    if os.path.exists(xmp):
        try:
            m=re.search(r"DateTimeOriginal>?\s*(\d{4})-(\d{2})-(\d{2})",open(xmp,encoding="utf-8",errors="ignore").read())
            if m:
                y,mo,d=map(int,m.groups())
                if plausible(y,mo,d): return datetime.date(y,mo,d)
        except Exception: pass
def trailing_seq(base):
    m=re.search(r"(\d{2,})$",base); return int(m.group(1)) if m else None
def is_event_folder(folder):
    if not single_level(folder): return False
    n=os.path.basename(norm(folder)).lower().strip()
    if n in GENERIC or GENERIC_RE.match(n): return False
    if re.fullmatch(r"[\d\-_ .]+",n): return False
    return True

def build_records(SRC):
    recs=[]
    for root,dirs,fs in os.walk(SRC):
        if os.path.basename(root)=="_organizer": dirs[:]=[]; continue
        for f in fs:
            full=os.path.join(root,f); rel=os.path.relpath(full,SRC)
            ext=f.rsplit(".",1)[-1].lower() if "." in f else ""; base=f[:-(len(ext)+1)] if ext else f
            try: size=os.path.getsize(full); mt=datetime.datetime.fromtimestamp(os.path.getmtime(full))
            except OSError: size=0; mt=datetime.datetime.now()
            recs.append(dict(full=full, rel=rel, fname=f, ext=ext, base=base, folder=os.path.dirname(rel) or ".",
                             size=size, mtime=mt, is_media=ext in MEDIA_EXT, nested=depth(rel)>=2,
                             date=None, date_source="", date_conf="", tier=0, note="", dest="", md5=""))
    return recs

def date_local(r):
    if not r["is_media"] or r["nested"]: return
    if r["size"]==0:
        r.update(note="zero-byte / corrupt", tier=7, date_source="none", date_conf="none"); return
    d=exif_date(r["full"],r["ext"]) or probe_date(r["full"],r["ext"])
    if d: r.update(date=d,date_source="embedded",date_conf="high",tier=1); return
    d=filename_date(r["fname"])
    if d: r.update(date=d,date_source="filename",date_conf="high",tier=2); return
    d=sidecar_date(r["full"])
    if d: r.update(date=d,date_source="sidecar",date_conf="high",tier=3); return

def assign_dates_global(recs):
    fmt=defaultdict(lambda: defaultdict(int))
    for r in recs: fmt[r["folder"]][r["mtime"].replace(second=0,microsecond=0)] += 1
    bulk={fo:{mt for mt,c in mm.items() if c>=20} for fo,mm in fmt.items()}
    byfolder=defaultdict(list)
    for r in recs:
        if r["is_media"] and not r["nested"]: byfolder[r["folder"]].append(r)
    for folder,group in byfolder.items():
        dated=[(trailing_seq(r["base"]),r["date"]) for r in group if r["date"] and r["tier"] in (1,2,3) and trailing_seq(r["base"]) is not None]
        if not dated: continue
        for r in group:
            if r["date"] or r["size"]==0: continue
            seq=trailing_seq(r["base"])
            if seq is None: continue
            near=sorted(((abs(seq-s),s,dt) for s,dt in dated),key=lambda x:x[0])[:2]
            cand=[dt for gap,s,dt in near if gap<=5]
            if not cand: continue
            r.update(date=min(cand),date_source="sequence",tier=4,
                     date_conf=("low" if len({c for c in cand})>1 else "medium"),
                     note="inferred from adjacent sequence numbers")
    for r in recs:
        if not r["is_media"] or r["nested"] or r["date"] or r["size"]==0: continue
        mtm=r["mtime"].replace(second=0,microsecond=0)
        art = mtm in bulk.get(r["folder"],set()) or not plausible(r["mtime"].year,r["mtime"].month,r["mtime"].day)
        if not art:
            r.update(date=r["mtime"].date(),date_source="mtime",date_conf="medium",tier=5); continue
        r.update(date_source="none",date_conf="none",tier=7,
                 note=(r["note"]+"; " if r["note"] else "")+"mtime rejected (bulk/implausible)")
    return bulk

def assign_dates(recs):
    for r in track(recs, "Reading dates", lambda r: r["folder"]): date_local(r)
    return assign_dates_global(recs)

def compute_hashes(recs):
    for r in track(recs, "Hashing files", lambda r: r["folder"]):
        try: r["md5"]=md5(r["full"])
        except OSError: r["md5"]=""

def assign_destinations(recs):
    placeable=[r for r in recs if r["is_media"] and not r["nested"] and r["size"]>0]
    seen={}; dupe_of={}
    for r in sorted(placeable,key=lambda x:x["rel"]):
        if r["md5"]:
            if r["md5"] in seen: dupe_of[r["rel"]]=seen[r["md5"]]
            else: seen[r["md5"]]=r["rel"]
    # Event anchoring: v5 used min(all dates), so one mis-dated file dragged a whole event
    # into the wrong year. Now: anchor on the MEDIAN date, name the event after the earliest
    # date within EVENT_SPAN of it, and only files within EVENT_SPAN join the event.
    event_dates={}; event_anchor={}
    for folder in {r["folder"] for r in placeable}:
        if is_event_folder(folder):
            ds=sorted(r["date"] for r in placeable if r["folder"]==folder and r["date"] and not dupe_of.get(r["rel"]))
            if not ds: continue
            med=ds[len(ds)//2]
            cluster=[x for x in ds if abs((x-med).days)<=EVENT_SPAN]
            event_dates[folder]=min(cluster); event_anchor[folder]=med
    daycount=defaultdict(int); used=defaultdict(int)
    for r in sorted(recs,key=lambda x:x["rel"]):
        rel=norm(r["rel"]); name=os.path.basename(rel); parent=os.path.dirname(rel)
        corrupt = r["is_media"] and (r["size"]==0 or (not r["nested"] and r["md5"]==""))
        dup = r["rel"] in dupe_of
        if corrupt or dup:
            sub=(parent+"/" if parent else "")
            bucket="corrupt" if corrupt else "duplicate"
            r["dest"]=f"untouched/{sub}{bucket}/{name}"
            r["route"]=bucket
            r["note"]=(r["note"]+"; " if r["note"] else "")+(f"duplicate of {dupe_of[r['rel']]}" if dup else "corrupt/zero-byte")
            continue
        if r["nested"]:
            r["dest"]=f"untouched/{rel}"; r["route"]="nested"; continue
        if not r["is_media"]:
            r["dest"]=f"_not-media/{rel}"; r["route"]="not-media"; continue
        if not r["date"]:
            r["dest"]=f"_needs-review/{rel}"; r["route"]="needs-review"; continue
        d=r["date"]; ev=event_dates.get(r["folder"]); med=event_anchor.get(r["folder"])
        if ev is not None and abs((d-med).days)<=EVENT_SPAN:
            fslug=slugify(os.path.basename(r['folder'])) or "event"
            evname=f"{ev.year}-{ev.month:02d}-{ev.day:02d}-{fslug}"
            destdir=f"{ev.year}/{ev.month:02d} - {MONTHS[ev.month]}/{evname}"
            r["event_name"]=evname
        else:
            destdir=f"{d.year}/{d.month:02d} - {MONTHS[d.month]}"; r["event_name"]=""
            if ev is not None:
                r["note"]=(r["note"]+"; " if r["note"] else "")+f"outside event window of {r['folder']}"
        slug=make_slug(r["base"])
        if slug is None:
            daycount[(destdir,d)]+=1
            fn=f"{d.year}-{d.month:02d}-{d.day:02d}-{daycount[(destdir,d)]:03d}.{r['ext']}"
        else:
            fn=f"{d.year}-{d.month:02d}-{d.day:02d}-{slug}.{r['ext']}"
        path=f"{destdir}/{fn}"
        if used[path.lower()]:
            # keep probing until we find a free suffixed name (v5 took -NN blindly and could
            # collide with a file that legitimately owns that name -> silent overwrite)
            stem,e=fn.rsplit(".",1); k=used[path.lower()]
            while True:
                cand_fn=f"{stem}-{k:02d}.{e}"; cand=f"{destdir}/{cand_fn}"
                if not used[cand.lower()]:
                    used[path.lower()]+=1; fn,path=cand_fn,cand; break
                k+=1
        used[path.lower()]+=1; r["dest"]=path; r["route"]="placed"
    return event_dates, dupe_of

LEDGER_FIELDS=["run_id","started_at","finished_at","source","destination","phase","total_files",
               "placed","untouched","corrupt_or_duplicate","not_media","needs_review","events","copied_count","notes"]
def read_ledger(org):
    p=os.path.join(org,"ledger.csv")
    return list(csv.DictReader(open(p,encoding="utf-8"))) if os.path.exists(p) else []
def write_ledger(org, rows):
    with open(os.path.join(org,"ledger.csv"),"w",newline="",encoding="utf-8") as fh:
        w=csv.DictWriter(fh,fieldnames=LEDGER_FIELDS); w.writeheader()
        for r in rows: w.writerow({k:r.get(k,"") for k in LEDGER_FIELDS})

def cmd_plan(args):
    global MIN_YEAR, EVENT_SPAN
    MIN_YEAR=getattr(args,"min_year",None) or MIN_YEAR
    EVENT_SPAN=getattr(args,"event_span_days",None) or EVENT_SPAN
    SRC=os.path.abspath(args.source); DST=os.path.abspath(args.dest)
    if not os.path.isdir(SRC): sys.exit(f"source not found: {SRC}")
    check_overlap(SRC,DST)
    os.makedirs(os.path.join(DST,"_organizer"), exist_ok=True)
    _info(f"[bold]Scanning[/] {SRC}   (Pillow={'yes' if HAVE_PIL else 'no'}, HEIC={'yes' if HAVE_HEIF else 'no'}, ffprobe={'yes' if have_ffprobe() else 'no'})")
    with status("Discovering files..."):
        recs=build_records(SRC)
    _info(f"Found [bold]{len(recs)}[/] files.")
    assign_dates(recs); compute_hashes(recs)
    event_dates,dupe_of=assign_destinations(recs)
    write_run_outputs(SRC,DST,recs,event_dates,dupe_of)

def write_run_outputs(SRC,DST,recs,event_dates,dupe_of):
    org=os.path.join(DST,"_organizer"); os.makedirs(org,exist_ok=True)
    run_id=datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    rundir=os.path.join(org,"runs",run_id); os.makedirs(rundir,exist_ok=True)
    started=datetime.datetime.now().isoformat(timespec="seconds")
    with open(os.path.join(rundir,"plan.csv"),"w",newline="",encoding="utf-8") as fh:
        w=csv.writer(fh)
        w.writerow(["source_path","proposed_destination","route","date_used","date_source","date_confidence","tier","event_folder","md5","notes"])
        for r in sorted(recs,key=lambda x:x["rel"]):
            w.writerow([r["rel"],r["dest"],r.get("route",""),r["date"].isoformat() if r["date"] else "",
                        r["date_source"],r["date_conf"],r["tier"],r.get("event_name",""),r["md5"],r["note"]])
    def cnt(route): return len([r for r in recs if r.get("route")==route])
    placed=cnt("placed"); nested=cnt("nested"); cod=cnt("corrupt")+cnt("duplicate")
    notmedia=cnt("not-media"); needs=cnt("needs-review")
    by_tier=defaultdict(int)
    for r in recs:
        if r.get("route")=="placed": by_tier[r["tier"]]+=1
    ym=defaultdict(int)
    for r in recs:
        if r.get("route")=="placed": ym["/".join(r["dest"].split("/")[:2])]+=1
    state=dict(run_id=run_id,source=SRC,destination=DST,phase="awaiting-approval",
               plan_path=f"_organizer/runs/{run_id}/plan.csv",started_at=started,finished_at=None,
               totals=dict(total_files=len(recs),placed=placed,untouched=nested,corrupt_or_duplicate=cod,
                           not_media=notmedia,needs_review=needs,events=len(event_dates)),
               events={f:d.isoformat() for f,d in event_dates.items()})
    with open(os.path.join(rundir,"state.json"),"w",encoding="utf-8") as fh:
        json.dump(state,fh,indent=2)
    lab={1:"embedded (high)",2:"filename (high)",3:"sidecar (high)",4:"sequence (med/low)",5:"mtime (med)",6:"folder-month (low)",7:"needs-review"}
    sm=[f"# Media Organizer run {run_id}\n",f"- Started: {started}",f"- Source: `{SRC}`",f"- Destination: `{DST}`",
        f"- Phase: **awaiting-approval**\n","## Disposition (every file is copied somewhere)",
        f"- Total files: {len(recs)}",f"- Placed into year/month: {placed}",
        f"- Untouched (nested >1 deep): {nested}",f"- Corrupt: {cnt('corrupt')}   Duplicate: {cnt('duplicate')}",
        f"- Not-media: {notmedia}",f"- Needs-review: {needs}\n","## Date-source tiers (placed)"]
    for t in range(1,8): sm.append(f"- tier {t} {lab[t]}: {by_tier[t]}")
    sm.append("\n## Events (single-level folders): %d"%len(event_dates))
    for f,d in sorted(event_dates.items()):
        n=len([r for r in recs if r["folder"]==f and r.get("route")=="placed"])
        sm.append(f"- {d.isoformat()}  `{f}`  ({n})")
    sm.append("\n## Placed per year/month")
    for k in sorted(ym): sm.append(f"- {k}: {ym[k]}")
    with open(os.path.join(rundir,"summary.md"),"w",encoding="utf-8") as fh:
        fh.write("\n".join(sm)+"\n")
    open(os.path.join(rundir,"copied.log"),"a",encoding="utf-8").close()
    rows=read_ledger(org)
    rows.append(dict(run_id=run_id,started_at=started,finished_at="",source=SRC,destination=DST,
                     phase="awaiting-approval",total_files=len(recs),placed=placed,untouched=nested,
                     corrupt_or_duplicate=cod,not_media=notmedia,needs_review=needs,events=len(event_dates),
                     copied_count=0,notes="dry-run complete"))
    write_ledger(org,rows)
    print(f"\nRUN {run_id}  --  phase: awaiting-approval")
    print(f"  total={len(recs)} placed={placed} untouched={nested} corrupt/dup={cod} not-media={notmedia} needs-review={needs}")
    print("  placed tiers:",dict(by_tier)," events:",len(event_dates))
    print(f"\nReview: {os.path.join(rundir,'summary.md')}\n        {os.path.join(rundir,'plan.csv')}")
    print(f"Then run:  python {os.path.basename(__file__)} execute --dest \"{DST}\"")

def _pick_run(org, run_id):
    rows=read_ledger(org)
    if run_id:
        m=[r for r in rows if r["run_id"]==run_id]; return m[0] if m else None
    live=[r for r in rows if r["phase"] in ("awaiting-approval","copying","interrupted")]
    return live[-1] if live else None

def _save_state(rundir, state):
    with open(os.path.join(rundir,"state.json"),"w",encoding="utf-8") as fh:
        json.dump(state,fh,indent=2)

def cmd_execute(args):
    DST=os.path.abspath(args.dest); org=os.path.join(DST,"_organizer")
    row=_pick_run(org,args.run)
    if not row: sys.exit("no run awaiting approval / in progress. Run `plan` first.")
    run_id=row["run_id"]; rundir=os.path.join(org,"runs",run_id)
    state=json.load(open(os.path.join(rundir,"state.json"),encoding="utf-8")); SRC=state["source"]
    plan=list(csv.DictReader(open(os.path.join(rundir,"plan.csv"),encoding="utf-8")))
    logpath=os.path.join(rundir,"copied.log"); done={}
    if os.path.exists(logpath):
        for line in open(logpath,encoding="utf-8"):
            p=line.rstrip("\n").split("\t")
            if len(p)>=5 and p[4]=="OK": done[p[1]]=p[3]
    # Incremental skip: content hashes already imported into this library by PRIOR runs.
    #   default        -> skip if its content was imported before AND that copy still exists
    #                     (checked at the RECORDED destination, so renumbered plans don't re-copy).
    #   --skip-library -> skip if its content was imported before, even if since moved/renamed.
    # Manifest format: "md5<TAB>relative-dest" per line; legacy plain-hash lines still accepted.
    skip_library=getattr(args,"skip_library",False)
    manifest=os.path.join(org,"library.md5")
    prior={}                                    # hash -> recorded dest ("" if unknown/legacy)
    if os.path.exists(manifest):
        for l in open(manifest,encoding="utf-8"):
            l=l.rstrip("\n")
            if not l.strip(): continue
            h,_,dp=l.partition("\t"); prior.setdefault(h,dp)
    lib=dict(prior)
    state["phase"]="copying"; _save_state(rundir,state)
    planned=[r for r in plan if r["proposed_destination"]]
    copied=skipped=skipped_inc=0; failed=[]; resolved=0; seen_dirs=set()
    try:
        with open(logpath,"a",encoding="utf-8") as logf:
            for r in track(planned, "Copying", lambda r: os.path.dirname(r["source_path"]) or ".", log_folders=True):
                srel=r["source_path"]; dest=r["proposed_destination"]; exp=r["md5"]
                srcp=os.path.join(SRC,srel); dstp=os.path.join(DST,dest)
                # (a) already finished earlier in THIS run (resume)
                if srel in done and os.path.exists(dstp):
                    skipped+=1; resolved+=1
                    if exp: lib.setdefault(exp,dest)
                    continue
                # (b) already imported by a PRIOR run (incremental skip)
                if exp and exp in prior:
                    known=prior[exp]; knownp=os.path.join(DST,known) if known else None
                    if skip_library or (knownp and os.path.exists(knownp)) or os.path.exists(dstp):
                        skipped_inc+=1; resolved+=1; lib.setdefault(exp,known or dest); continue
                # (c) copy it -- announce each destination folder the first time we create it
                ddir=os.path.dirname(dest)
                if ddir not in seen_dirs:
                    seen_dirs.add(ddir); _info(f"  [cyan]+ dest[/] {ddir or '(root)'}")
                now=datetime.datetime.now().isoformat(timespec="seconds")
                try:
                    os.makedirs(os.path.dirname(dstp),exist_ok=True)
                    shutil.copy2(srcp,dstp); h=md5(dstp)
                except OSError as e:
                    # v5 crashed the whole run here; now: log FAILED, keep going, retry on resume
                    failed.append((srel,dest,str(e)))
                    logf.write(f"{now}\t{srel}\t{dest}\t\tFAILED\t{e}\n"); logf.flush(); continue
                if exp and h!=exp:
                    failed.append((srel,dest,"hash mismatch after copy"))
                    logf.write(f"{now}\t{srel}\t{dest}\t{h}\tFAILED\thash mismatch\n"); logf.flush(); continue
                logf.write(f"{now}\t{srel}\t{dest}\t{h}\tOK\n"); logf.flush()
                copied+=1; resolved+=1; lib[exp or h]=dest
    finally:
        # persist the manifest even on Ctrl-C so incremental skip keeps working
        with open(manifest,"w",encoding="utf-8") as mf:
            for hsh in sorted(lib):
                if hsh: mf.write(f"{hsh}\t{lib[hsh]}\n")
    print(f"run {run_id}: copied={copied} skipped-in-run={skipped} skipped-already-imported={skipped_inc} failed={len(failed)}")
    print(f"  destination folders touched: {len(seen_dirs)}")
    on_disk=[r for r in planned if os.path.exists(os.path.join(DST,r["proposed_destination"]))]
    for r in (random.sample(on_disk,min(10,len(on_disk))) if on_disk else []):
        ok=md5(os.path.join(SRC,r["source_path"]))==md5(os.path.join(DST,r["proposed_destination"]))
        print(f"  spot-check [{'OK' if ok else 'FAIL'}] {r['source_path']}")
    final="completed" if (resolved==len(planned) and not failed) else "interrupted"
    finished=datetime.datetime.now().isoformat(timespec="seconds")
    state.update(phase=final,finished_at=finished,result=dict(copied=copied,skipped=skipped,skipped_already_imported=skipped_inc,failed=len(failed),planned=len(planned),present=len(on_disk)))
    _save_state(rundir,state)
    rows=read_ledger(org)
    for r in rows:
        if r["run_id"]==run_id: r["phase"]=final; r["finished_at"]=finished; r["copied_count"]=copied+skipped+skipped_inc
    write_ledger(org,rows)
    print(f"phase: {final}  (resolved {resolved}/{len(planned)}: copied {copied}, already had {skipped_inc})")
    if failed:
        print(f"FAILURES ({len(failed)}, all logged in copied.log; `resume` will retry them):")
        for srel,dest,why in failed[:10]: print(f"  {srel} -> {dest}: {why}")

def cmd_status(args):
    org=os.path.join(os.path.abspath(args.dest),"_organizer")
    for r in read_ledger(org):
        print(f"{r['run_id']}  {r['phase']:<16} placed={r.get('placed','?')} copied={r.get('copied_count','?')}  {r['source']}")

def cmd_run(args):
    """One step: build the plan, then immediately copy + verify (no separate review)."""
    cmd_plan(args)
    print()
    cmd_execute(args)


def _human(n):
    n=float(n)
    for u in ("B","KB","MB","GB","TB"):
        if n<1024: return f"{n:.1f} {u}"
        n/=1024
    return f"{n:.1f} PB"

def _sig_quick(p):
    sz=os.path.getsize(p); h=hashlib.md5(); h.update(str(sz).encode())
    with open(p,"rb") as fh:
        h.update(fh.read(65536))
        if sz>131072: fh.seek(-65536,2); h.update(fh.read(65536))
    return h.hexdigest()

def _walk_sizes(root, skip_org):
    out=[]
    for r,dirs,fs in os.walk(root):
        if skip_org and os.path.basename(r)=="_organizer": dirs[:]=[]; continue
        for fn in fs:
            full=os.path.join(r,fn)
            try: sz=os.path.getsize(full)
            except OSError: continue
            out.append((full, os.path.relpath(full,root), sz))
    return out

def cmd_verify(args):
    SRC=os.path.abspath(args.source); DST=os.path.abspath(args.dest)
    check_overlap(SRC,DST)
    quick=getattr(args,"quick",False); sig=_sig_quick if quick else md5
    _info(f"[bold]Verifying[/] source vs destination  ([cyan]{'quick' if quick else 'full-hash'}[/] compare)")
    _info(f"  source: {SRC}\n  dest  : {DST}   (the dest _organizer/ folder is ignored)")
    with status("Listing files..."):
        srcf=_walk_sizes(SRC, False); dstf=_walk_sizes(DST, True)
    srcmap={}                                    # hash -> [count, size, [rel paths]]
    for full,rel,sz in track(srcf, "Hashing source", lambda x: os.path.dirname(x[1]) or "."):
        try: hh=sig(full)
        except OSError: continue
        e=srcmap.setdefault(hh,[0,0,[]]); e[0]+=1; e[1]=sz; e[2].append(rel)
    dstmap=defaultdict(list)                     # hash -> [(rel,size),...]
    for full,rel,sz in track(dstf, "Hashing destination", lambda x: os.path.dirname(x[1]) or "."):
        try: hh=sig(full)
        except OSError: continue
        dstmap[hh].append((rel,sz))
    src_bytes=sum(sz for _,_,sz in srcf); dst_bytes=sum(sz for _,_,sz in dstf)
    extra=[]; excess=[]; missing=[]              # missing: (src rel path, copies missing, bytes)
    for hh,items in dstmap.items():
        dc=len(items); sc=srcmap.get(hh,[0,0,[]])[0]
        if sc==0:
            for rel,s in items: extra.append((rel,s))       # content not in source at all
        elif dc>sc:
            for rel,s in items[sc:]: excess.append((rel,s)) # more copies than source has
    for hh,(sc,sz,rels) in srcmap.items():
        dc=len(dstmap.get(hh,[]))
        if dc<sc: missing.append((rels[0],sc-dc,(sc-dc)*sz))
    eb=sum(s for _,s in extra); xb=sum(s for _,s in excess); mb=sum(b for _,_,b in missing)
    mcount=sum(c for _,c,_ in missing)
    print()
    _info("[bold]==================== VERIFY SUMMARY ====================[/]")
    _info(f"  Source     : {len(srcf):>7} files   {_human(src_bytes)}")
    _info(f"  Destination: {len(dstf):>7} files   {_human(dst_bytes)}   (excl. _organizer)")
    _info(f"  Size delta : {_human(dst_bytes-src_bytes)}  (destination minus source)")
    print()
    _info(f"  [red]MISSING from destination[/] (source content not fully copied): {mcount} file(s), {_human(mb)}")
    _info(f"  [yellow]EXTRA in destination[/] (content NOT in source at all):      {len(extra)} file(s), {_human(eb)}")
    _info(f"  [yellow]DUPLICATE copies in destination[/] (beyond source's count):  {len(excess)} file(s), {_human(xb)}")
    print()
    _info(f"  => The destination is larger mostly because of EXTRA + DUPLICATE = {_human(eb+xb)}")
    if mb>0: _info("  => WARNING: some source content is missing from the destination (see report).")
    # write report -- now includes the missing files themselves (v5 omitted them)
    org=os.path.join(DST,"_organizer"); os.makedirs(org,exist_ok=True)
    rep=os.path.join(org,"verify-"+datetime.datetime.now().strftime("%Y%m%d-%H%M%S")+".csv")
    with open(rep,"w",newline="",encoding="utf-8") as fh:
        w=csv.writer(fh); w.writerow(["category","path","size_bytes"])
        for rel,c,b in sorted(missing,key=lambda x:-x[2]): w.writerow(["missing-from-destination (source path)",rel,b])
        for rel,s in sorted(extra,key=lambda x:-x[1]): w.writerow(["extra-not-in-source",rel,s])
        for rel,s in sorted(excess,key=lambda x:-x[1]): w.writerow(["duplicate-extra-copy",rel,s])
    _info(f"\n  Full list of missing/extra/duplicate files (largest first): {rep}")


def main():
    ap=argparse.ArgumentParser(description="Deterministic media organizer (photos/video/audio). v6 'fable'")
    sub=ap.add_subparsers(dest="cmd",required=True)
    def add_plan_opts(sp):
        sp.add_argument("--source",required=True); sp.add_argument("--dest",required=True)
        sp.add_argument("--min-year",dest="min_year",type=int,default=1995,help="reject dates before this year (default 1995)")
        sp.add_argument("--event-span-days",dest="event_span_days",type=int,default=31,
                        help="files further than this from an event folder's typical date are filed by their own date (default 31)")
    p=sub.add_parser("plan"); add_plan_opts(p)
    g=sub.add_parser("run"); add_plan_opts(g); g.add_argument("--run",default=None); g.add_argument("--skip-library",dest="skip_library",action="store_true")
    e=sub.add_parser("execute"); e.add_argument("--dest",required=True); e.add_argument("--run",default=None); e.add_argument("--skip-library",dest="skip_library",action="store_true")
    r=sub.add_parser("resume"); r.add_argument("--dest",required=True); r.add_argument("--run",default=None); r.add_argument("--skip-library",dest="skip_library",action="store_true")
    s=sub.add_parser("status"); s.add_argument("--dest",required=True)
    vf=sub.add_parser("verify"); vf.add_argument("--source",required=True); vf.add_argument("--dest",required=True); vf.add_argument("--quick",action="store_true")
    a=ap.parse_args()
    {"plan":cmd_plan,"run":cmd_run,"execute":cmd_execute,"resume":cmd_execute,"status":cmd_status,"verify":cmd_verify}[a.cmd](a)

if __name__=="__main__":
    main()
