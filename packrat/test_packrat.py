import threading
import zipfile
from datetime import datetime
from ftplib import FTP
from pathlib import Path

import pytest
from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import FTPHandler
from pyftpdlib.servers import FTPServer

import packrat


STAMP = datetime(2026, 8, 10, 14, 32)


class TestArchiveName:
    def test_combines_date_time_and_slug(self):
        assert packrat.archive_name(STAMP, "valheim") == "2026-08-10-1432-valheim.zip"

    def test_zero_pads_date_and_time(self):
        early = datetime(2026, 1, 2, 3, 4)
        assert packrat.archive_name(early, "x") == "2026-01-02-0304-x.zip"


class TestRunDirname:
    def test_uses_date_and_time(self):
        assert packrat.run_dirname(STAMP) == "2026-08-10-1432"


class TestLoadEnvFile:
    def test_parses_key_value_pairs(self, tmp_path):
        env = tmp_path / ".env"
        env.write_text("FTP_HOST=example.com\nFTP_PASSWORD=hunter2\n")
        assert packrat.load_env_file(env) == {
            "FTP_HOST": "example.com",
            "FTP_PASSWORD": "hunter2",
        }

    def test_ignores_comments_and_blank_lines(self, tmp_path):
        env = tmp_path / ".env"
        env.write_text("# creds\n\nFTP_USER=me\n")
        assert packrat.load_env_file(env) == {"FTP_USER": "me"}

    def test_strips_optional_quotes(self, tmp_path):
        env = tmp_path / ".env"
        env.write_text('FTP_PASSWORD="p@ss=word"\n')
        assert packrat.load_env_file(env) == {"FTP_PASSWORD": "p@ss=word"}

    def test_missing_file_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            packrat.load_env_file(tmp_path / "nope.env")


class TestResolveCredential:
    def test_cli_value_wins_over_env_file(self):
        assert (
            packrat.resolve_credential("cli-pass", {"FTP_PASSWORD": "env-pass"}, "FTP_PASSWORD")
            == "cli-pass"
        )

    def test_falls_back_to_env_file(self):
        assert (
            packrat.resolve_credential(None, {"FTP_PASSWORD": "env-pass"}, "FTP_PASSWORD")
            == "env-pass"
        )

    def test_returns_none_when_absent_everywhere(self):
        assert packrat.resolve_credential(None, {}, "FTP_PASSWORD") is None


class TestDiffSnapshots:
    def test_no_changes(self):
        before = {"world.db": (100, "20260810120000")}
        assert packrat.diff_snapshots(before, dict(before)) == []

    def test_detects_size_change(self):
        before = {"world.db": (100, "20260810120000")}
        after = {"world.db": (250, "20260810120000")}
        assert packrat.diff_snapshots(before, after) == ["world.db"]

    def test_detects_mtime_change(self):
        before = {"world.db": (100, "20260810120000")}
        after = {"world.db": (100, "20260810121500")}
        assert packrat.diff_snapshots(before, after) == ["world.db"]

    def test_detects_new_and_removed_files(self):
        before = {"a": (1, "t"), "b": (2, "t")}
        after = {"b": (2, "t"), "c": (3, "t")}
        assert packrat.diff_snapshots(before, after) == ["a", "c"]


@pytest.fixture
def ftp_root(tmp_path):
    root = tmp_path / "ftproot"
    (root / "saves" / "worlds").mkdir(parents=True)
    (root / "saves" / "world.db").write_bytes(b"x" * 1000)
    (root / "saves" / "world.fwl").write_bytes(b"y" * 50)
    (root / "saves" / "worlds" / "old.db").write_bytes(b"z" * 200)
    (root / "saves" / "worlds" / "archive").mkdir()
    return root


@pytest.fixture
def ftp_server(ftp_root):
    authorizer = DummyAuthorizer()
    authorizer.add_user("tester", "secret", str(ftp_root), perm="elr")
    handler = FTPHandler
    handler.authorizer = authorizer
    server = FTPServer(("127.0.0.1", 0), handler)
    port = server.address[1]

    def serve():
        try:
            server.serve_forever(timeout=0.1, handle_exit=False)
        except OSError:
            pass  # benign race when close_all() is called from the test thread

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    yield "127.0.0.1", port
    server.close_all()
    thread.join(timeout=5)


@pytest.fixture
def ftp_conn(ftp_server):
    host, port = ftp_server
    ftp = FTP()
    ftp.connect(host, port, timeout=10)
    ftp.login("tester", "secret")
    yield ftp
    try:
        ftp.quit()
    except Exception:
        pass


class TestWalkRemote:
    def test_finds_all_files_recursively_with_sizes(self, ftp_conn):
        snapshot = packrat.walk_remote(ftp_conn, "/saves")
        sizes = {path: size for path, (size, _mtime) in snapshot.items()}
        assert sizes == {
            "world.db": 1000,
            "world.fwl": 50,
            "worlds/old.db": 200,
        }

    def test_every_entry_has_a_nonempty_mtime(self, ftp_conn):
        snapshot = packrat.walk_remote(ftp_conn, "/saves")
        assert all(mtime for _size, mtime in snapshot.values())

    def test_works_without_mlsd_support(self, ftp_conn, monkeypatch):
        from ftplib import error_perm

        def no_mlsd(*args, **kwargs):
            raise error_perm("500 Unknown command.")

        monkeypatch.setattr(ftp_conn, "mlsd", no_mlsd)
        snapshot = packrat.walk_remote(ftp_conn, "/saves")
        assert set(snapshot) == {"world.db", "world.fwl", "worlds/old.db"}

    def test_works_when_server_rejects_opts_and_nlst(self, ftp_conn, monkeypatch):
        # Some game-host servers (e.g. G-Portal) implement MLSD but reject
        # both OPTS MLST and NLST with 502.
        from ftplib import error_perm

        real_sendcmd = ftp_conn.sendcmd

        def sendcmd(cmd):
            if cmd.upper().startswith("OPTS"):
                raise error_perm("502 'opts' not implemented")
            return real_sendcmd(cmd)

        def no_nlst(*args, **kwargs):
            raise error_perm("502 'nlst' not implemented")

        monkeypatch.setattr(ftp_conn, "sendcmd", sendcmd)
        monkeypatch.setattr(ftp_conn, "nlst", no_nlst)
        snapshot = packrat.walk_remote(ftp_conn, "/saves")
        assert set(snapshot) == {"world.db", "world.fwl", "worlds/old.db"}

    def test_missing_root_reports_mlsd_error_not_the_nlst_fallback_error(self, ftp_conn, monkeypatch):
        # MLSD on a nonexistent path returns 550 (501 on pyftpdlib). Servers
        # without NLST must not turn that into a misleading
        # "502 'nlst' not implemented" (seen on a real G-Portal server).
        from ftplib import error_perm

        def no_nlst(*args, **kwargs):
            raise error_perm("502 'nlst' not implemented")

        monkeypatch.setattr(ftp_conn, "nlst", no_nlst)
        with pytest.raises(error_perm, match="^(550|501) No such"):
            packrat.walk_remote(ftp_conn, "/does-not-exist")


def _shape(entries):
    """Collapse a tree into a comparable {name: children-or-None} nest."""
    return {
        e.name + ("/" if e.kind == "dir" else ""): (None if e.children is None else _shape(e.children))
        for e in entries
    }


class TestListTree:
    def test_depth_one_lists_only_direct_folders(self, ftp_conn):
        tree = packrat.list_tree(ftp_conn, "/saves", depth=1)
        assert _shape(tree) == {"worlds/": None}

    def test_depth_two_expands_one_level_and_marks_cutoff_as_unknown(self, ftp_conn):
        tree = packrat.list_tree(ftp_conn, "/saves", depth=2)
        assert _shape(tree) == {"worlds/": {"archive/": None}}

    def test_depth_beyond_tree_yields_empty_children_not_unknown(self, ftp_conn):
        tree = packrat.list_tree(ftp_conn, "/saves", depth=5)
        assert _shape(tree) == {"worlds/": {"archive/": {}}}

    def test_files_flag_adds_files_with_sizes_after_folders(self, ftp_conn):
        tree = packrat.list_tree(ftp_conn, "/saves", depth=2, files=True)
        assert [(e.name, e.kind, e.size) for e in tree] == [
            ("worlds", "dir", None),
            ("world.db", "file", 1000),
            ("world.fwl", "file", 50),
        ]
        assert [(e.name, e.kind, e.size) for e in tree[0].children] == [
            ("archive", "dir", None),
            ("old.db", "file", 200),
        ]

    def test_folders_only_omits_files_at_every_level(self, ftp_conn):
        tree = packrat.list_tree(ftp_conn, "/saves", depth=3)
        assert all(e.kind == "dir" for e in tree)
        assert all(e.kind == "dir" for e in tree[0].children)

    def test_falls_back_to_nlst_when_mlsd_unsupported(self, ftp_conn, monkeypatch):
        from ftplib import error_perm

        def no_mlsd(*args, **kwargs):
            raise error_perm("500 Unknown command.")

        monkeypatch.setattr(ftp_conn, "mlsd", no_mlsd)
        tree = packrat.list_tree(ftp_conn, "/saves", depth=2, files=True)
        assert _shape(tree) == {"worlds/": {"archive/": None, "old.db": None}, "world.db": None, "world.fwl": None}
        assert {e.name: e.size for e in tree if e.kind == "file"} == {"world.db": 1000, "world.fwl": 50}

    def test_missing_path_raises_the_server_error(self, ftp_conn):
        from ftplib import error_perm

        with pytest.raises(error_perm, match="No such"):
            packrat.list_tree(ftp_conn, "/nope", depth=1)


class TestDownloadTree:
    def test_downloads_files_preserving_structure(self, ftp_conn, tmp_path):
        dest = tmp_path / "out"
        snapshot = packrat.walk_remote(ftp_conn, "/saves")
        packrat.download_tree(ftp_conn, "/saves", dest, snapshot)
        assert (dest / "world.db").read_bytes() == b"x" * 1000
        assert (dest / "world.fwl").read_bytes() == b"y" * 50
        assert (dest / "worlds" / "old.db").read_bytes() == b"z" * 200

    def test_reports_progress_per_chunk(self, ftp_conn, tmp_path):
        seen = []
        snapshot = packrat.walk_remote(ftp_conn, "/saves")
        packrat.download_tree(
            ftp_conn, "/saves", tmp_path / "out", snapshot,
            on_bytes=lambda n: seen.append(n),
        )
        assert sum(seen) == 1250


class TestZipDirectory:
    def test_zips_all_files_with_relative_paths(self, tmp_path):
        src = tmp_path / "src"
        (src / "sub").mkdir(parents=True)
        (src / "a.txt").write_text("aaa")
        (src / "sub" / "b.txt").write_text("bbb")
        target = tmp_path / "backup.zip"
        packrat.zip_directory(src, target)
        with zipfile.ZipFile(target) as zf:
            assert sorted(zf.namelist()) == ["a.txt", "sub/b.txt"]
            assert zf.read("sub/b.txt") == b"bbb"


class TestRunBackup:
    def test_zip_mode_creates_datestamped_archive_and_no_leftovers(self, ftp_conn, tmp_path):
        dest = tmp_path / "backups"
        result = packrat.run_backup(
            ftp_conn, "/saves", dest, slug="valheim", zip_mode=True, now=STAMP
        )
        archive = dest / "2026-08-10-1432-valheim.zip"
        assert result.artifact == archive
        assert result.changed == []
        with zipfile.ZipFile(archive) as zf:
            assert sorted(zf.namelist()) == ["world.db", "world.fwl", "worlds/old.db"]
        assert [p.name for p in dest.iterdir()] == [archive.name]

    def test_plain_mode_downloads_into_dated_subfolder(self, ftp_conn, tmp_path):
        dest = tmp_path / "backups"
        result = packrat.run_backup(ftp_conn, "/saves", dest, zip_mode=False, now=STAMP)
        run_dir = dest / "2026-08-10-1432"
        assert result.artifact == run_dir
        assert (run_dir / "world.db").read_bytes() == b"x" * 1000
        assert (run_dir / "worlds" / "old.db").exists()

    def test_detects_files_changed_during_download(self, ftp_root, ftp_conn, tmp_path):
        mutated = {"done": False}

        def mutate_once(_n):
            if not mutated["done"]:
                (ftp_root / "saves" / "world.db").write_bytes(b"X" * 2000)
                mutated["done"] = True

        result = packrat.run_backup(
            ftp_conn, "/saves", tmp_path / "backups", zip_mode=False, now=STAMP,
            on_bytes=mutate_once,
        )
        assert "world.db" in result.changed


class TestNeedsDownload:
    def test_missing_local_file(self, tmp_path):
        assert packrat.needs_download(tmp_path / "nope", 10, "20260810143200") is True

    def test_same_size_and_mtime_is_up_to_date(self, tmp_path):
        local = tmp_path / "f"
        local.write_bytes(b"x" * 10)
        packrat.stamp_mtime(local, "20260810143200")
        assert packrat.needs_download(local, 10, "20260810143200") is False

    def test_size_mismatch(self, tmp_path):
        local = tmp_path / "f"
        local.write_bytes(b"x" * 10)
        packrat.stamp_mtime(local, "20260810143200")
        assert packrat.needs_download(local, 11, "20260810143200") is True

    def test_mtime_mismatch(self, tmp_path):
        local = tmp_path / "f"
        local.write_bytes(b"x" * 10)
        packrat.stamp_mtime(local, "20260810143200")
        assert packrat.needs_download(local, 10, "20260810143201") is True

    def test_unknown_server_mtime_falls_back_to_size(self, tmp_path):
        local = tmp_path / "f"
        local.write_bytes(b"x" * 10)
        assert packrat.needs_download(local, 10, "?") is False
        assert packrat.needs_download(local, 9, "?") is True


class TestSyncMode:
    def test_first_run_mirrors_into_slug_folder_with_server_mtimes(self, ftp_conn, tmp_path):
        dest = tmp_path / "backups"
        result = packrat.run_backup(ftp_conn, "/saves", dest, slug="valheim", sync=True)
        mirror = dest / "valheim"
        assert result.artifact == mirror
        assert result.skipped == 0
        assert result.files == 3
        assert (mirror / "world.db").read_bytes() == b"x" * 1000
        assert (mirror / "worlds" / "old.db").exists()
        server_mtime = packrat.walk_remote(ftp_conn, "/saves")["world.db"][1]
        assert packrat.needs_download(mirror / "world.db", 1000, server_mtime) is False

    def test_second_run_transfers_nothing(self, ftp_conn, tmp_path):
        dest = tmp_path / "backups"
        packrat.run_backup(ftp_conn, "/saves", dest, slug="valheim", sync=True)
        transferred = []
        result = packrat.run_backup(
            ftp_conn, "/saves", dest, slug="valheim", sync=True, on_bytes=transferred.append
        )
        assert result.skipped == 3
        assert transferred == []

    def test_only_changed_file_is_refetched(self, ftp_root, ftp_conn, tmp_path):
        import os, time
        dest = tmp_path / "backups"
        packrat.run_backup(ftp_conn, "/saves", dest, slug="valheim", sync=True)
        changed = ftp_root / "saves" / "world.fwl"
        changed.write_bytes(b"Y" * 75)
        os.utime(changed, (time.time() + 100, time.time() + 100))  # ensure a new mtime
        transferred = []
        result = packrat.run_backup(
            ftp_conn, "/saves", dest, slug="valheim", sync=True, on_bytes=transferred.append
        )
        assert result.skipped == 2
        assert sum(transferred) == 75
        assert (dest / "valheim" / "world.fwl").read_bytes() == b"Y" * 75

    def test_parser_accepts_sync(self):
        args = packrat.build_parser().parse_args(["--sync"])
        assert args.sync is True
        assert packrat.build_parser().parse_args([]).sync is False

    def test_main_rejects_sync_with_zip(self, capsys):
        rc = packrat.main(
            ["--host", "h", "--user", "u", "--password", "p", "--remote", "/r",
             "--dest", "/tmp/x", "--sync", "--zip"]
        )
        assert rc == 2
        assert "--sync" in capsys.readouterr().out

    def test_main_reports_up_to_date_count(self, ftp_server, tmp_path, capsys):
        host, port = ftp_server
        base = ["--host", host, "--port", str(port), "--user", "tester", "--password", "secret",
                "--remote", "/saves", "--dest", str(tmp_path), "--slug", "valheim", "--sync"]
        assert packrat.main(base) == 0
        capsys.readouterr()
        assert packrat.main(base) == 0
        out = capsys.readouterr().out
        assert "3 up to date" in out
        assert "Downloading" not in out  # no empty progress bar when nothing to fetch


class TestCliParser:
    def test_parses_full_invocation(self):
        args = packrat.build_parser().parse_args(
            ["--host", "209.126.11.33", "--port", "31931", "--user", "gp",
             "--password", "pw", "--remote", "/save", "--dest", "/tmp/b",
             "--zip", "--slug", "valheim"]
        )
        assert args.host == "209.126.11.33"
        assert args.port == 31931
        assert args.zip is True
        assert args.slug == "valheim"

    def test_port_defaults_to_21_and_slug_to_backup(self):
        args = packrat.build_parser().parse_args(
            ["--host", "h", "--user", "u", "--remote", "/r", "--dest", "d"]
        )
        assert args.port == 21
        assert args.zip is False
        assert args.slug == "backup"


class TestListCli:
    def test_parser_accepts_list_depth_and_files(self):
        args = packrat.build_parser().parse_args(
            ["--host", "h", "--user", "u", "--list", "/x", "--depth", "3", "--files"]
        )
        assert args.list == "/x"
        assert args.depth == 3
        assert args.files is True

    def test_depth_defaults_to_two_and_files_off(self):
        args = packrat.build_parser().parse_args(["--list", "/x"])
        assert args.depth == 2
        assert args.files is False

    def test_list_mode_does_not_require_remote_or_dest(self, ftp_server, capsys):
        host, port = ftp_server
        rc = packrat.main(
            ["--host", host, "--port", str(port), "--user", "tester", "--password", "secret",
             "--list", "/saves", "--depth", "2", "--files"]
        )
        out = capsys.readouterr().out
        assert rc == 0
        assert "Missing required" not in out
        assert "worlds" in out and "archive" in out and "old.db" in out and "world.fwl" in out

    def test_list_mode_marks_unexpanded_folders(self, ftp_server, capsys):
        host, port = ftp_server
        packrat.main(
            ["--host", host, "--port", str(port), "--user", "tester", "--password", "secret",
             "--list", "/saves", "--depth", "1"]
        )
        out = capsys.readouterr().out
        assert "worlds" in out and "archive" not in out
        assert "…" in out


class TestFilterSnapshot:
    SNAP = {
        "run2.db": (100, "t"),
        "run2.fwl": (10, "t"),
        "run2.db.old": (100, "t"),
        "run2_backup_auto-20260817.db": (90, "t"),
        "worlds_local/old.db": (50, "t"),
        "notes.txt": (5, "t"),
    }

    def test_no_filters_keeps_everything(self):
        assert packrat.filter_snapshot(self.SNAP, [], []) == self.SNAP

    def test_includes_are_a_whitelist(self):
        out = packrat.filter_snapshot(self.SNAP, ["run2.db", "run2.fwl"], [])
        assert sorted(out) == ["run2.db", "run2.fwl"]

    def test_pattern_without_slash_matches_basename_anywhere(self):
        out = packrat.filter_snapshot(self.SNAP, ["*.db"], [])
        assert sorted(out) == [
            "run2.db",
            "run2_backup_auto-20260817.db",
            "worlds_local/old.db",
        ]

    def test_pattern_with_slash_matches_full_relative_path(self):
        out = packrat.filter_snapshot(self.SNAP, ["worlds_local/*"], [])
        assert sorted(out) == ["worlds_local/old.db"]

    def test_excludes_subtract(self):
        out = packrat.filter_snapshot(self.SNAP, [], ["*.old", "*backup*"])
        assert sorted(out) == ["notes.txt", "run2.db", "run2.fwl", "worlds_local/old.db"]

    def test_excludes_win_over_includes(self):
        out = packrat.filter_snapshot(self.SNAP, ["run2.*"], ["*.old"])
        assert sorted(out) == ["run2.db", "run2.fwl"]


class TestFiltersEndToEnd:
    def test_run_backup_downloads_only_matching_files(self, ftp_conn, tmp_path):
        dest = tmp_path / "backups"
        result = packrat.run_backup(
            ftp_conn, "/saves", dest, slug="w", zip_mode=True, now=STAMP,
            includes=["world.*"], excludes=["*.fwl"],
        )
        with zipfile.ZipFile(dest / "2026-08-10-1432-w.zip") as zf:
            assert zf.namelist() == ["world.db"]
        assert result.files == 1
        assert result.total_bytes == 1000

    def test_parser_accepts_repeated_include_and_exclude(self):
        args = packrat.build_parser().parse_args(
            ["--host", "h", "--user", "u", "--remote", "/r", "--dest", "d",
             "--include", "run2.db", "--include", "run2.fwl", "--exclude", "*.old"]
        )
        assert args.include == ["run2.db", "run2.fwl"]
        assert args.exclude == ["*.old"]

    def test_parser_defaults_to_no_filters(self):
        args = packrat.build_parser().parse_args(
            ["--host", "h", "--user", "u", "--remote", "/r", "--dest", "d"]
        )
        assert args.include == []
        assert args.exclude == []
