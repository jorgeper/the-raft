"""The offline demo must reach done, exercising a changes-requested cycle."""

from studio.demo import run_demo


def test_demo_reaches_done(tmp_path, capsys):
    final = run_demo(tmp_path / "demo")
    assert final == "done"
    out = capsys.readouterr().out
    assert "pr:changes-requested" in out  # the review loop actually looped
    assert "state: done" in out


def test_improve_demo_completes(tmp_path):
    """§11.11: the improvement-cycle demo applies a human-approved prompt diff."""
    from studio.demo import run_improve_demo

    assert run_improve_demo(tmp_path / "improve") is True
    coder_md = tmp_path / "improve" / "studio" / "prompts" / "evolving" / "coder.md"
    assert "Run the standing gates" in coder_md.read_text()
