"""Channel-aware message types.

Instead of returning plain strings, commands and processors can return
Message objects that render differently depending on the destination
channel (Telegram vs email).

For backwards compatibility, plain strings are still supported everywhere.
Use render_response() to handle both cases.
"""


class Message:
    """Base class for channel-aware messages."""

    def render(self, channel: str) -> str:
        """Render this message for the given channel.

        Args:
            channel: "telegram" or "email"
        """
        raise NotImplementedError


class TextMessage(Message):
    """Plain text — same on all channels."""

    def __init__(self, text: str) -> None:
        self.text = text

    def render(self, channel: str) -> str:
        return self.text


class TableMessage(Message):
    """Tabular data — compact list on Telegram, full table on email.

    Args:
        title: Header text shown above the table.
        headers: Column names (used in email table header).
        rows: List of rows, each row is a list of strings matching headers.
        footer: Optional text shown below the table.
        telegram_columns: Which column indices to show on Telegram (default: first two).
                          Keeps Telegram output concise for narrow screens.
    """

    def __init__(
        self,
        title: str,
        headers: list[str],
        rows: list[list[str]],
        footer: str = "",
        telegram_columns: list[int] | None = None,
    ) -> None:
        self.title = title
        self.headers = headers
        self.rows = rows
        self.footer = footer
        self.telegram_columns = telegram_columns if telegram_columns is not None else [0, 1]

    def render(self, channel: str) -> str:
        if channel == "telegram":
            return self._render_telegram()
        return self._render_email()

    def _render_telegram(self) -> str:
        """Compact list format for Telegram's narrow screen."""
        lines = [f"📋 {self.title}", ""]

        if not self.rows:
            lines.append("(none)")
        else:
            for row in self.rows:
                # Join the selected columns with " — "
                parts = [row[i] for i in self.telegram_columns if i < len(row)]
                lines.append(" — ".join(parts))

        if self.footer:
            lines.extend(["", self.footer])

        return "\n".join(lines)

    def _render_email(self) -> str:
        """HTML table for email — renders nicely in Gmail and other clients."""
        import html as html_mod

        if not self.rows:
            body = "<p>(none)</p>"
        else:
            # Build HTML table with inline styles (email clients ignore <style> blocks)
            header_cells = "".join(
                f'<th style="text-align:left;padding:8px 12px;border-bottom:2px solid #ddd;'
                f'color:#555;font-size:13px;font-weight:600;">{html_mod.escape(h)}</th>'
                for h in self.headers
            )

            data_rows = []
            for i, row in enumerate(self.rows):
                bg = "#f9f9f9" if i % 2 == 0 else "#ffffff"
                cells = "".join(
                    f'<td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;">'
                    f'{html_mod.escape(cell)}</td>'
                    for cell in row
                )
                data_rows.append(f'<tr style="background:{bg};">{cells}</tr>')

            body = (
                f'<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;">'
                f'<thead><tr style="background:#f5f5f5;">{header_cells}</tr></thead>'
                f'<tbody>{"".join(data_rows)}</tbody>'
                f'</table>'
            )

        footer_html = f'<p style="color:#888;font-size:13px;margin-top:12px;">{html_mod.escape(self.footer)}</p>' if self.footer else ""

        return (
            f'<div style="font-family:Arial,sans-serif;">'
            f'<h2 style="margin:0 0 16px 0;font-size:18px;color:#333;">{html_mod.escape(self.title)}</h2>'
            f'{body}'
            f'{footer_html}'
            f'</div>'
        )

    @property
    def is_html(self) -> bool:
        """Whether the email rendering is HTML (used by email handler to send as html)."""
        return True


def render_response(response: str | Message, channel: str) -> tuple[str, bool]:
    """Render a response for the given channel.

    Handles both plain strings and Message objects.

    Returns:
        (rendered_text, is_html) — is_html is True when the email channel
        produces HTML output (so the email handler can send it as html).
    """
    if isinstance(response, Message):
        text = response.render(channel)
        is_html = channel == "email" and hasattr(response, "is_html") and response.is_html
        return text, is_html
    return response, False
