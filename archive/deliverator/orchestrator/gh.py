"""Everything the loop needs from GitHub reduces to four verbs: read issues by
label (the poll), comment (the log), move a label (the state transition), and
open a PR (the deliverable). Agents narrate everything as issue comments, so the
issue timeline becomes the loop's user interface."""
import os

from github import Github
from dotenv import load_dotenv

load_dotenv()

_gh = Github(os.environ["GITHUB_TOKEN"])
repo = _gh.get_repo(os.environ["GITHUB_REPO"])


def issues_with_label(label: str):
    return list(repo.get_issues(state="open", labels=[label]))


def comment(issue_number: int, body: str):
    repo.get_issue(issue_number).create_comment(body)


def set_label(issue_number: int, new_label: str, remove: list[str]):
    issue = repo.get_issue(issue_number)
    for lbl in remove:
        try:
            issue.remove_from_labels(lbl)
        except Exception:
            pass  # already gone (e.g. you flipped it by hand) — fine
    issue.add_to_labels(new_label)


def open_pr(head_branch: str, title: str, body: str, base: str = "main"):
    return repo.create_pull(title=title, body=body, head=head_branch, base=base)


def open_pr_for_branch(branch: str):
    prs = [p for p in repo.get_pulls(state="open") if p.head.ref == branch]
    return prs[0] if prs else None


def open_pr_url_for_issue(issue_number: int):
    """html_url of the open PR for this issue's branch, or None — lets the bot
    link the implementation PR without threading it through the loop."""
    pr = open_pr_for_branch(f"agent/issue-{issue_number}")
    return pr.html_url if pr else None
