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
        """Full markdown table for email's wider layout."""
        lines = [self.title, ""]

        if not self.rows:
            lines.append("(none)")
        else:
            # Calculate column widths
            widths = [len(h) for h in self.headers]
            for row in self.rows:
                for i, cell in enumerate(row):
                    if i < len(widths):
                        widths[i] = max(widths[i], len(cell))

            # Header row
            header = "| " + " | ".join(h.ljust(widths[i]) for i, h in enumerate(self.headers)) + " |"
            separator = "|" + "|".join("-" * (w + 2) for w in widths) + "|"
            lines.append(header)
            lines.append(separator)

            # Data rows
            for row in self.rows:
                cells = []
                for i, cell in enumerate(row):
                    w = widths[i] if i < len(widths) else len(cell)
                    cells.append(cell.ljust(w))
                lines.append("| " + " | ".join(cells) + " |")

        if self.footer:
            lines.extend(["", self.footer])

        return "\n".join(lines)


def render_response(response: str | Message, channel: str) -> str:
    """Render a response for the given channel.

    Handles both plain strings (returned as-is) and Message objects
    (rendered for the channel). Use this in bot.py and email_handler.py.
    """
    if isinstance(response, Message):
        return response.render(channel)
    return response
