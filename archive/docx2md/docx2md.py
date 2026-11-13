#!/usr/bin/env python3
"""
docx2md.py — Convert Word (.docx) files to Markdown.

Images are extracted to an `images/` folder next to the output .md file,
named `<mdname>-1.png`, `<mdname>-2.jpg`, ... and embedded with HTML
<img> tags that preserve the display size used in Word.

Modes:
  file   Convert a single .docx file
  crawl  Recursively convert every .docx under a directory (restartable)
  status Show crawl progress
  reset  Clear crawl progress

Examples:
  python docx2md.py file "C:\\docs\\report.docx"
  python docx2md.py crawl "C:\\docs"
  python docx2md.py crawl "C:\\docs" --force      # reconvert everything
  python docx2md.py status "C:\\docs"
  python docx2md.py reset "C:\\docs"

Dependencies:  pip install python-docx rich
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph
from rich.console import Console
from rich.progress import (
    BarColumn,
    MofNCompleteColumn,
    Progress,
    SpinnerColumn,
    TextColumn,
    TimeElapsedColumn,
)
from rich.table import Table as RichTable

console = Console()

PROGRESS_FILENAME = ".docx2md_progress.json"
EMU_PER_PIXEL = 9525  # 914400 EMU/inch at 96 dpi


# --------------------------------------------------------------------------
# Conversion
# --------------------------------------------------------------------------

class ImageSaver:
    """Saves images to <out_dir>/images/<stem>-N.<ext>, numbering sequentially."""

    def __init__(self, out_dir: Path, stem: str):
        self.images_dir = out_dir / "images"
        self.stem = stem
        self.count = 0

    def save(self, blob: bytes, ext: str) -> str:
        self.count += 1
        self.images_dir.mkdir(exist_ok=True)
        name = f"{self.stem}-{self.count}{ext}"
        (self.images_dir / name).write_bytes(blob)
        return f"images/{name}"


def _img_tag(rel_path: str, width_px: int | None, height_px: int | None) -> str:
    attrs = f'src="{rel_path}"'
    if width_px:
        attrs += f' width="{width_px}"'
    if height_px:
        attrs += f' height="{height_px}"'
    return f"<img {attrs}>"


def _extract_drawing(drawing, part, saver: ImageSaver) -> str:
    """Handle a w:drawing element (inline or anchored image)."""
    blip = drawing.find(".//" + qn("a:blip"))
    if blip is None:
        return ""
    rid = blip.get(qn("r:embed"))
    if not rid or rid not in part.related_parts:
        return ""
    image_part = part.related_parts[rid]
    ext = Path(str(image_part.partname)).suffix or ".png"
    rel_path = saver.save(image_part.blob, ext)

    width = height = None
    extent = drawing.find(".//" + qn("wp:extent"))
    if extent is not None:
        try:
            width = round(int(extent.get("cx")) / EMU_PER_PIXEL)
            height = round(int(extent.get("cy")) / EMU_PER_PIXEL)
        except (TypeError, ValueError):
            width = height = None
    return _img_tag(rel_path, width, height)


def _extract_vml(pict, part, saver: ImageSaver) -> str:
    """Handle legacy VML images (w:pict / v:imagedata)."""
    imagedata = pict.find(".//{urn:schemas-microsoft-com:vml}imagedata")
    if imagedata is None:
        return ""
    rid = imagedata.get(qn("r:id"))
    if not rid or rid not in part.related_parts:
        return ""
    image_part = part.related_parts[rid]
    ext = Path(str(image_part.partname)).suffix or ".png"
    rel_path = saver.save(image_part.blob, ext)

    width = height = None
    shape = pict.find(".//{urn:schemas-microsoft-com:vml}shape")
    if shape is not None and shape.get("style"):
        m = re.search(r"width:([\d.]+)pt", shape.get("style"))
        if m:
            width = round(float(m.group(1)) * 96 / 72)
        m = re.search(r"height:([\d.]+)pt", shape.get("style"))
        if m:
            height = round(float(m.group(1)) * 96 / 72)
    return _img_tag(rel_path, width, height)


def _run_segments(r_el, part, saver: ImageSaver):
    """Yield (text, bold, italic, strike, verbatim) segments from a w:r element."""
    rpr = r_el.find(qn("w:rPr"))

    def _on(tag):
        if rpr is None:
            return False
        el = rpr.find(qn(f"w:{tag}"))
        return el is not None and el.get(qn("w:val")) not in ("0", "false", "none")

    bold, italic, strike = _on("b"), _on("i"), _on("strike")

    for child in r_el.iterchildren():
        tag = child.tag
        if tag == qn("w:t"):
            yield (child.text or "", bold, italic, strike, False)
        elif tag == qn("w:tab"):
            yield ("\t", bold, italic, strike, False)
        elif tag == qn("w:br"):
            yield ("  \n", False, False, False, True)
        elif tag == qn("w:drawing"):
            md = _extract_drawing(child, part, saver)
            if md:
                yield (md, False, False, False, True)
        elif tag == qn("w:pict"):
            md = _extract_vml(child, part, saver)
            if md:
                yield (md, False, False, False, True)


def _render_segments(segments) -> str:
    """Merge adjacent segments with identical formatting, then wrap with markdown."""
    merged = []
    for text, b, i, s, verbatim in segments:
        if verbatim:
            merged.append((text, False, False, False, True))
        elif merged and not merged[-1][4] and merged[-1][1:4] == (b, i, s):
            merged[-1] = (merged[-1][0] + text, b, i, s, False)
        else:
            merged.append((text, b, i, s, False))

    out = []
    for text, b, i, s, verbatim in merged:
        if verbatim or not text.strip():
            out.append(text)
            continue
        # keep leading/trailing whitespace outside the markers
        lead = text[: len(text) - len(text.lstrip())]
        trail = text[len(text.rstrip()):]
        core = text.strip()
        if b:
            core = f"**{core}**"
        if i:
            core = f"*{core}*"
        if s:
            core = f"~~{core}~~"
        out.append(lead + core + trail)
    return "".join(out)


def _paragraph_content(para: Paragraph, part, saver: ImageSaver) -> str:
    """Render runs + hyperlinks of a paragraph to markdown inline text."""
    segments = []
    for child in para._p.iterchildren():
        if child.tag == qn("w:r"):
            segments.extend(_run_segments(child, part, saver))
        elif child.tag == qn("w:hyperlink"):
            inner = []
            for r in child.findall(qn("w:r")):
                inner.extend(_run_segments(r, part, saver))
            text = _render_segments(inner)
            rid = child.get(qn("r:id"))
            url = None
            if rid:
                rel = part.rels.get(rid)
                if rel is not None and rel.is_external:
                    url = rel.target_ref
            segments.append((f"[{text}]({url})" if url else text,
                             False, False, False, True))
    return _render_segments(segments)


def _list_info(para: Paragraph, doc) -> tuple[int, bool] | None:
    """Return (indent_level, is_numbered) if the paragraph is a list item."""
    ppr = para._p.find(qn("w:pPr"))
    numpr = ppr.find(qn("w:numPr")) if ppr is not None else None
    if numpr is None:
        # fall back to style-based lists (e.g. "List Bullet 2", "List Number")
        style = (para.style.name or "") if para.style else ""
        m = re.match(r"List (Bullet|Number)(?: (\d))?$", style)
        if m:
            level = int(m.group(2)) - 1 if m.group(2) else 0
            return level, m.group(1) == "Number"
        return None
    ilvl_el = numpr.find(qn("w:ilvl"))
    numid_el = numpr.find(qn("w:numId"))
    level = int(ilvl_el.get(qn("w:val"))) if ilvl_el is not None else 0
    numbered = False
    try:
        num_id = numid_el.get(qn("w:val"))
        numbering = doc.part.numbering_part.element
        num = numbering.find(f'.//{qn("w:num")}[@{qn("w:numId")}="{num_id}"]')
        abs_id = num.find(qn("w:abstractNumId")).get(qn("w:val"))
        abstract = numbering.find(
            f'.//{qn("w:abstractNum")}[@{qn("w:abstractNumId")}="{abs_id}"]')
        lvl = abstract.find(f'.//{qn("w:lvl")}[@{qn("w:ilvl")}="{level}"]')
        fmt = lvl.find(qn("w:numFmt")).get(qn("w:val"))
        numbered = fmt != "bullet"
    except (AttributeError, KeyError, NotImplementedError):
        pass
    return level, numbered


def _table_to_md(table: Table, part, saver: ImageSaver) -> str:
    rows = []
    for row in table.rows:
        cells = []
        for cell in row.cells:
            parts = [_paragraph_content(p, part, saver).strip()
                     for p in cell.paragraphs]
            text = "<br>".join(x for x in parts if x)
            cells.append(text.replace("|", "\\|").replace("\n", " "))
        rows.append(cells)
    if not rows:
        return ""
    ncols = max(len(r) for r in rows)
    rows = [r + [""] * (ncols - len(r)) for r in rows]
    lines = ["| " + " | ".join(rows[0]) + " |",
             "|" + "---|" * ncols]
    for r in rows[1:]:
        lines.append("| " + " | ".join(r) + " |")
    return "\n".join(lines)


def convert(docx_path: Path, quiet: bool = False) -> Path:
    """Convert one .docx file. Returns the path of the written .md file."""
    doc = Document(str(docx_path))
    part = doc.part
    out_dir = docx_path.parent
    stem = docx_path.stem
    saver = ImageSaver(out_dir, stem)
    blocks: list[str] = []

    for child in doc.element.body.iterchildren():
        if child.tag == qn("w:p"):
            para = Paragraph(child, doc)
            content = _paragraph_content(para, part, saver)
            style = (para.style.name or "") if para.style else ""
            m = re.match(r"Heading (\d)", style)
            if m and content.strip():
                blocks.append("#" * int(m.group(1)) + " " + content.strip())
            elif style == "Title" and content.strip():
                blocks.append("# " + content.strip())
            else:
                info = _list_info(para, doc)
                if info and content.strip():
                    level, numbered = info
                    marker = "1." if numbered else "-"
                    blocks.append("  " * level + f"{marker} {content.strip()}")
                elif content.strip():
                    blocks.append(content)
        elif child.tag == qn("w:tbl"):
            md = _table_to_md(Table(child, doc), part, saver)
            if md:
                blocks.append(md)

    # collapse consecutive list items into one block (no blank lines between)
    text_parts: list[str] = []
    prev_list = False
    for b in blocks:
        is_list = bool(re.match(r"\s*(-|1\.) ", b))
        if text_parts:
            text_parts.append("\n" if (is_list and prev_list) else "\n\n")
        text_parts.append(b)
        prev_list = is_list
    md_text = "".join(text_parts).rstrip() + "\n"

    out_path = out_dir / (stem + ".md")
    out_path.write_text(md_text, encoding="utf-8")
    if not quiet:
        console.print(f"[green]✓[/green] {docx_path} → {out_path}"
                      + (f"  [dim]({saver.count} image(s))[/dim]" if saver.count else ""))
    return out_path


# --------------------------------------------------------------------------
# Progress tracking
# --------------------------------------------------------------------------

def _progress_path(root: Path) -> Path:
    return root / PROGRESS_FILENAME

def _load_progress(root: Path) -> dict:
    p = _progress_path(root)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            console.print("[yellow]Warning: progress file corrupt, starting fresh.[/yellow]")
    return {}

def _save_progress(root: Path, data: dict) -> None:
    tmp = _progress_path(root).with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
    tmp.replace(_progress_path(root))


# --------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------

def _find_docx(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*.docx")
                  if not p.name.startswith("~$"))  # skip Word lock files


def cmd_file(args) -> int:
    path = Path(args.path)
    if not path.is_file() or path.suffix.lower() != ".docx":
        console.print(f"[red]Not a .docx file:[/red] {path}")
        return 1
    with console.status(f"Converting {path.name}..."):
        convert(path)
    return 0


def cmd_crawl(args) -> int:
    root = Path(args.path)
    if not root.is_dir():
        console.print(f"[red]Not a directory:[/red] {root}")
        return 1

    files = _find_docx(root)
    if not files:
        console.print("No .docx files found.")
        return 0

    progress_data = {} if args.force else _load_progress(root)
    done = failed = skipped = 0

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        MofNCompleteColumn(),
        TimeElapsedColumn(),
        console=console,
    ) as bar:
        task = bar.add_task("Converting", total=len(files))
        for f in files:
            key = str(f.resolve())
            mtime = f.stat().st_mtime
            entry = progress_data.get(key)
            if entry and entry.get("status") == "done" and entry.get("mtime") == mtime:
                skipped += 1
                bar.advance(task)
                continue
            bar.update(task, description=f"[cyan]{f.name}[/cyan]")
            try:
                convert(f, quiet=True)
                progress_data[key] = {"status": "done", "mtime": mtime,
                                      "when": time.strftime("%Y-%m-%d %H:%M:%S")}
                done += 1
            except Exception as e:
                progress_data[key] = {"status": "failed", "mtime": mtime,
                                      "error": str(e),
                                      "when": time.strftime("%Y-%m-%d %H:%M:%S")}
                failed += 1
                console.print(f"[red]✗ {f}: {e}[/red]")
            _save_progress(root, progress_data)  # save after every file → restartable
            bar.advance(task)

    t = RichTable(title="Crawl summary", show_header=False)
    t.add_row("Converted", f"[green]{done}[/green]")
    t.add_row("Skipped (already done)", f"[dim]{skipped}[/dim]")
    t.add_row("Failed", f"[red]{failed}[/red]" if failed else "0")
    console.print(t)
    if failed:
        console.print("[dim]Failed files will be retried on the next crawl.[/dim]")
    return 1 if failed else 0


def cmd_status(args) -> int:
    root = Path(args.path)
    data = _load_progress(root)
    files = _find_docx(root)
    done = [k for k, v in data.items() if v.get("status") == "done"]
    failed = {k: v for k, v in data.items() if v.get("status") == "failed"}

    t = RichTable(title=f"Progress for {root}")
    t.add_column("Metric")
    t.add_column("Count", justify="right")
    t.add_row("Word files found", str(len(files)))
    t.add_row("Converted", f"[green]{len(done)}[/green]")
    t.add_row("Failed", f"[red]{len(failed)}[/red]" if failed else "0")
    t.add_row("Remaining", str(max(0, len(files) - len(done))))
    console.print(t)
    for k, v in failed.items():
        console.print(f"[red]✗[/red] {k}: [dim]{v.get('error', '?')}[/dim]")
    return 0


def cmd_reset(args) -> int:
    p = _progress_path(Path(args.path))
    if p.exists():
        p.unlink()
        console.print(f"[green]Progress cleared:[/green] {p}")
    else:
        console.print("No progress file found — nothing to reset.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Convert Word (.docx) files to Markdown with extracted, sized images.")
    sub = ap.add_subparsers(dest="command", required=True)

    p = sub.add_parser("file", help="Convert a single .docx file")
    p.add_argument("path", help="Path to the .docx file")
    p.set_defaults(func=cmd_file)

    p = sub.add_parser("crawl", help="Recursively convert all .docx under a directory")
    p.add_argument("path", help="Root directory to crawl")
    p.add_argument("--force", action="store_true",
                   help="Reconvert files even if already marked done")
    p.set_defaults(func=cmd_crawl)

    p = sub.add_parser("status", help="Show crawl progress for a directory")
    p.add_argument("path", help="Root directory")
    p.set_defaults(func=cmd_status)

    p = sub.add_parser("reset", help="Clear crawl progress for a directory")
    p.add_argument("path", help="Root directory")
    p.set_defaults(func=cmd_reset)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
