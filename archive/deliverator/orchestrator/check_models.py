"""Model IDs and prices drift constantly. Run this before touching roles.py —
it prints current OpenRouter slugs and per-token prices for the families the
loop cares about. No API key needed (public endpoint)."""
import httpx

r = httpx.get("https://openrouter.ai/api/v1/models", timeout=30)
want = ["haiku", "sonnet", "opus", "gemini", "deepseek", "qwen", "gpt"]
for m in sorted(r.json()["data"], key=lambda x: x["id"]):
    if any(w in m["id"].lower() for w in want):
        p = m.get("pricing", {})
        print(f'{m["id"]:<48} prompt=${p.get("prompt", "?")}/tok  '
              f'completion=${p.get("completion", "?")}/tok')
