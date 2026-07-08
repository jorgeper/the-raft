"""Everything the loop needs from GitHub reduces to four verbs: read issues by
label (the poll), comment (the log), move a label (the state transition), and
open a PR (the deliverable). Agents narrate everything as issue comments, so the
issue timeline becomes the loop's user interface."""
import os

from github import Github, GithubException
from dotenv import load_dotenv
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

load_dotenv()


# Parallel passes raise the odds of secondary rate limits — retry the API verbs
# a few times with backoff on rate-limit/5xx before giving up.
def _retryable(e: BaseException) -> bool:
    return (isinstance(e, GithubException)
            and e.status in (403, 429, 500, 502, 503, 504))


_with_retry = retry(retry=retry_if_exception(_retryable),
                    stop=stop_after_attempt(3),
                    wait=wait_exponential(multiplier=1, max=8),
                    reraise=True)

# The client is created on first use, not at import — so tests (and tools like
# dashboard.py) can import this module without a token or network access.
_repo = None


def _get_repo():
    global _repo
    if _repo is None:
        _repo = Github(os.environ["GITHUB_TOKEN"]).get_repo(os.environ["GITHUB_REPO"])
    return _repo


def __getattr__(name):
    if name == "repo":                # keep the `gh.repo` spelling working lazily
        return _get_repo()
    raise AttributeError(name)


@_with_retry
def issues_with_label(label: str):
    return list(_get_repo().get_issues(state="open", labels=[label]))


@_with_retry
def comment(issue_number: int, body: str):
    _get_repo().get_issue(issue_number).create_comment(body)


@_with_retry
def set_label(issue_number: int, new_label: str, remove: list[str]):
    issue = _get_repo().get_issue(issue_number)
    for lbl in remove:
        try:
            issue.remove_from_labels(lbl)
        except Exception:
            pass  # already gone (e.g. you flipped it by hand) — fine
    issue.add_to_labels(new_label)


@_with_retry
def open_pr(head_branch: str, title: str, body: str, base: str = "main"):
    return _get_repo().create_pull(title=title, body=body, head=head_branch, base=base)


@_with_retry
def open_pr_for_branch(branch: str):
    prs = [p for p in _get_repo().get_pulls(state="open") if p.head.ref == branch]
    return prs[0] if prs else None
