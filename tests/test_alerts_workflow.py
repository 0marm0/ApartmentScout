"""The scheduled alerts workflow (.github/workflows/alerts.yml): valid, off by default, minimal permissions, no secrets, never run by CI,
and its issue step does the right thing for a first run, a quiet day, a new day and a second run on the same day (a fake `gh`)."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "alerts.yml"
FLOW = yaml.safe_load(WORKFLOW.read_text())
JOB = FLOW["jobs"]["alerts"]
ON = FLOW.get("on", FLOW.get(True))     # PyYAML reads the bare key `on` as the boolean True


def text_of(step: dict) -> str:
    return " ".join(str(step.get(k, "")) for k in ("uses", "name", "run"))


def steps_by_name(fragment: str) -> list[dict]:
    return [s for s in JOB["steps"] if fragment.lower() in text_of(s).lower()]


def test_it_is_valid_yaml_with_one_job_and_named_steps() -> None:
    assert set(FLOW["jobs"]) == {"alerts"} and JOB["runs-on"] == "ubuntu-latest" and JOB["timeout-minutes"] <= 30
    for s in JOB["steps"]:
        assert ("uses" in s) != ("run" in s), s


def test_it_runs_daily_and_by_hand_and_never_from_a_push_or_a_pull_request() -> None:
    assert set(ON) == {"schedule", "workflow_dispatch"}, "CI events must never start it"
    (cron,) = ON["schedule"]
    minute, hour, dom, month, dow = cron["cron"].split()
    assert minute.isdigit() and hour.isdigit() and (dom, month, dow) == ("*", "*", "*"), "once a day"
    assert FLOW["concurrency"]["cancel-in-progress"] is False


def test_it_is_off_unless_the_repository_variable_says_on() -> None:
    cond = re.sub(r"\s+", "", str(JOB["if"]))
    assert cond == "${{vars.APARTMENTSCOUT_ALERTS=='on'}}"
    assert "if" not in FLOW, "the gate belongs to the job so that every step is skipped"


def test_permissions_are_the_minimum_and_there_is_no_secret() -> None:
    assert FLOW["permissions"] == {"contents": "read", "issues": "write"}
    assert "permissions" not in JOB or JOB["permissions"] == FLOW["permissions"]
    text = WORKFLOW.read_text()
    assert "secrets." not in text
    assert JOB["env"]["GH_TOKEN"] == "${{ github.token }}"


def test_only_first_party_actions_pinned_to_a_major_version() -> None:
    used = [s["uses"] for s in JOB["steps"] if "uses" in s]
    assert used and all(re.fullmatch(r"actions/[a-z-]+(?:/[a-z-]+)?@v\d+", u) for u in used), used


def test_nothing_from_the_event_is_pasted_into_a_shell_script() -> None:
    for s in JOB["steps"]:
        for expr in re.findall(r"\$\{\{(.*?)\}\}", s.get("run", "")):
            assert "github.event" not in expr and "inputs" not in expr and "vars." not in expr, expr


def test_the_baseline_is_restored_before_the_digest_and_saved_after_the_issue() -> None:
    names = [text_of(s) for s in JOB["steps"]]
    restore = next(i for i, n in enumerate(names) if "cache/restore" in n)
    digest = next(i for i, n in enumerate(names) if "alerts --search" in n)
    issue = next(i for i, n in enumerate(names) if "gh issue" in n)
    save = next(i for i, n in enumerate(names) if "cache/save" in n)
    assert restore < digest < issue < save, "a failed issue step must leave the baseline where it was"


def test_the_monitor_step_is_a_separate_opt_in() -> None:
    (step,) = steps_by_name("apartmentscout monitor")
    assert step["if"].replace(" ", "") == "${{env.MONITOR=='on'}}" and "--apply" in step["run"] and "score" in step["run"]


def test_the_issue_step_reads_fields_the_digest_has() -> None:
    from apartmentscout import alerts as A
    d = A.make_digest(None, A.snapshot([], {}, None))
    script = steps_by_name("Open or update today")[0]["run"]
    for key in re.findall(r"jq -r \.(\w+) alerts\.json", script):
        assert key in d, key


def test_actionlint_accepts_it_when_it_is_installed() -> None:
    exe = shutil.which("actionlint")
    if not exe:
        pytest.skip("actionlint is not installed (the structure tests above stand in)")
    r = subprocess.run([exe, str(WORKFLOW)], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr


# --------------------------------------------------------------------------- the issue step, with a fake gh
needs_tools = pytest.mark.skipif(not (shutil.which("jq") and shutil.which("bash")), reason="needs jq and bash")


def run_issue_step(tmp_path: Path, digest: dict, md: str, existing: str = "", today: str = "2026-10-15") -> list[str]:
    """Run the workflow's issue step with `gh` and `date` replaced by fakes; returns the lines gh was called with."""
    script = steps_by_name("Open or update today")[0]["run"]
    bin = tmp_path / "bin"
    bin.mkdir()
    log = tmp_path / "gh.log"
    (bin / "gh").write_text(
        '#!/bin/bash\necho "$*" >> "$GH_LOG"\n'
        'if [ "$1 $2" = "issue list" ]; then\n'
        '  jq -r "$(echo "$*" | sed -E \'s/.*--jq //\')" <<< "$GH_LIST"\n'
        'fi\n'
        'if [ "$1 $2" = "issue create" ] && [ -n "$GH_FAIL_ASSIGN" ] && echo "$*" | grep -q -- --assignee; then exit 1; fi\n')
    (bin / "date").write_text(f'#!/bin/bash\necho {today}\n')
    for f in ("gh", "date"):
        (bin / f).chmod(0o755)
    (tmp_path / "alerts.json").write_text(json.dumps(digest))
    (tmp_path / "alerts.md").write_text(md)
    env = {"PATH": f"{bin}:/usr/bin:/bin:/opt/homebrew/bin", "GH_LOG": str(log), "ASSIGNEE": "renter-login", "HOME": str(tmp_path),
           "GH_LIST": existing or "[]"}
    r = subprocess.run(["bash", "-c", script], cwd=tmp_path, env=env, capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stdout + r.stderr
    return log.read_text().splitlines() if log.exists() else []


def digest(total: int, first: bool = False, title: str = "ApartmentScout: 3 new, 2 price drops") -> dict:
    return {"title": title, "total": total, "first_run": first}


@needs_tools
def test_a_quiet_day_opens_no_issue(tmp_path) -> None:
    assert run_issue_step(tmp_path, digest(0, title="ApartmentScout: nothing new"), "# nothing") == []


@needs_tools
def test_a_day_with_changes_opens_one_issue_assigned_to_the_renter(tmp_path) -> None:
    calls = run_issue_step(tmp_path, digest(5), "# ApartmentScout: 3 new, 2 price drops\n")
    create = [c for c in calls if c.startswith("issue create")]
    assert len(create) == 1 and "--assignee renter-login" in create[0] and "--title ApartmentScout: 3 new, 2 price drops" in create[0]
    assert "--label apartmentscout-alerts" in create[0]
    assert (tmp_path / "body.md").read_text().startswith("<!-- apartmentscout-alerts:2026-10-15 -->\n# ApartmentScout")


@needs_tools
def test_the_first_run_says_alerts_are_on(tmp_path) -> None:
    calls = run_issue_step(tmp_path, digest(0, first=True, title="ApartmentScout: alerts are on"), "# on\n")
    assert any(c.startswith("issue create") and "alerts are on" in c for c in calls)


@needs_tools
def test_a_second_run_the_same_day_updates_that_issue_and_comments(tmp_path) -> None:
    listing = json.dumps([{"number": 41, "body": "<!-- apartmentscout-alerts:2026-10-14 -->\nyesterday"},
                          {"number": 57, "body": "<!-- apartmentscout-alerts:2026-10-15 -->\ntoday"}])
    calls = run_issue_step(tmp_path, digest(4), "# x\n", existing=listing)
    assert not any(c.startswith("issue create") for c in calls)
    assert any(c.startswith("issue edit 57 ") for c in calls) and any(c.startswith("issue comment 57 ") for c in calls)


@needs_tools
def test_yesterdays_issue_is_not_reused_for_today(tmp_path) -> None:
    listing = json.dumps([{"number": 41, "body": "<!-- apartmentscout-alerts:2026-10-14 -->\nyesterday"}])
    calls = run_issue_step(tmp_path, digest(4), "# x\n", existing=listing)
    assert any(c.startswith("issue create") for c in calls) and not any(c.startswith("issue edit") for c in calls)
