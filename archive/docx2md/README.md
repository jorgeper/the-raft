# docx2md

Convert Word (`.docx`) files to Markdown, preserving images at their original display size.

## Install

```
pip install python-docx rich
```

## Usage

```
python docx2md.py file <path.docx>      # convert a single file
python docx2md.py crawl <dir>           # recursively convert every .docx under <dir>
python docx2md.py crawl <dir> --force   # reconvert even files already done
python docx2md.py status <dir>          # show crawl progress
python docx2md.py reset <dir>           # clear crawl progress
```

## Output

For each `report.docx`, the converter writes next to it:

```
report.docx
report.md
images/
  report-1.png
  report-2.jpg
  ...
```

Images are embedded with HTML tags that match the display size used in Word (at 96 dpi), so the Markdown renders as close to the original document as possible:

```html
<img src="images/report-1.png" width="384" height="216">
```

## What gets converted

Headings (`Heading 1-9`, `Title`), bold / italic / strikethrough, hyperlinks, bullet and numbered lists (including nesting), tables, inline and floating images, and legacy VML images from older documents.

## Crawl mode and restartability

Crawl mode walks the directory tree and converts every `.docx` it finds (Word lock files `~$*.docx` are skipped). Progress is saved to `.docx2md_progress.json` in the crawl root **after every file**, so the crawl can be interrupted at any time and restarted safely:

- Files already converted are skipped on restart.
- A file is reconverted if its modification time changed since it was converted.
- Failed files are recorded with their error and retried on the next crawl.
- `status` shows found / converted / failed / remaining counts and lists failures.
- `reset` deletes the progress file so the next crawl starts from scratch; `--force` reconverts everything in one shot without clearing history.

Exit code is non-zero if any file failed, so it can be used in scripts.

## Notes

- Only `.docx` is supported (not legacy `.doc`).
- You may want to add `.docx2md_progress.json` to `.gitignore` if you crawl inside a repo.
