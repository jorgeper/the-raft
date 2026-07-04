"""Dead-simple local cost dashboard (Guide 3, Part A.3). Reads the loop's own
cost log and writes a static costs.html you open in a browser. No API, no auth."""
import csv
import collections
import pathlib
import datetime

LOG = pathlib.Path(__file__).parent / "logs" / "costs.csv"


def build():
    by_role, by_day, total = collections.Counter(), collections.Counter(), 0.0
    rows = list(csv.DictReader(LOG.open())) if LOG.exists() else []
    for r in rows:
        c = float(r["cost_usd"])
        total += c
        by_role[r["role"]] += c
        by_day[r["ts"][:10]] += c

    def rows_html(counter):
        return "".join(f"<tr><td>{k}</td><td>${v:.4f}</td></tr>"
                       for k, v in counter.most_common())

    html = f"""<!doctype html><meta charset=utf-8>
<title>Agentic loop costs</title>
<style>body{{font:14px system-ui;margin:2rem;max-width:640px}}
table{{border-collapse:collapse;width:100%;margin:1rem 0}}
td,th{{border:1px solid #ddd;padding:6px 10px;text-align:left}}
h1 small{{color:#888;font-weight:400}}</style>
<h1>Agentic loop spend <small>as of {datetime.datetime.utcnow():%Y-%m-%d %H:%M} UTC</small></h1>
<p><b>Total: ${total:.4f}</b> across {len(rows)} calls</p>
<h2>By role</h2><table><tr><th>Role</th><th>Spend</th></tr>{rows_html(by_role)}</table>
<h2>By day</h2><table><tr><th>Day</th><th>Spend</th></tr>{rows_html(by_day)}</table>"""
    out = pathlib.Path(__file__).parent / "costs.html"
    out.write_text(html)
    print("Wrote", out, "— open it in your browser.")


if __name__ == "__main__":
    build()
