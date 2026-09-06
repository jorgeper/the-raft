"""One-shot plain-text report for `claude-usage --once`."""

from __future__ import annotations

from rich.console import Console
from rich.table import Table

from claude_usage.aggregate import Totals
from claude_usage.format import bar, fmt_delta, fmt_tokens, limit_label
from claude_usage.limits import Limit


def snapshot_text(limits: list[Limit] | None, stats: dict[str, Totals]) -> str:
    console = Console(record=True, width=100, file=open("/dev/null", "w"))
    if limits is None:
        console.print("[dim]rate limits unavailable[/]")
    else:
        table = Table.grid(padding=(0, 2))
        for limit in limits:
            table.add_row(limit_label(limit.kind), bar(limit.percent), fmt_delta(limit.resets_at))
        console.print(table)

    table = Table.grid(padding=(0, 2))
    table.add_column(min_width=14)
    for _ in range(4):
        table.add_column(justify="right")
    table.add_row("", "prompts", "output", "cache rd", "API value*")
    for name, label in (("today", "Today"), ("7d", "Last 7 days"), ("30d", "Last 30 days")):
        t = stats[name]
        table.add_row(
            label, str(t.prompts), fmt_tokens(t.output_tokens),
            fmt_tokens(t.cache_read_tokens), f"${t.cost_usd:,.2f}",
        )
    console.print(table)
    console.print("[dim]*API list prices — you pay a flat subscription, not this[/]")
    return console.export_text()
