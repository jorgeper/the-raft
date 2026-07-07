"""The offline demo must reach done, exercising a changes-requested cycle."""

from studio.demo import run_demo


def test_demo_reaches_done(tmp_path, capsys):
    final = run_demo(tmp_path / "demo")
    assert final == "done"
    out = capsys.readouterr().out
    assert "pr:changes-requested" in out  # the review loop actually looped
    assert "state: done" in out
