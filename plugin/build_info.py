from html import escape
from pathlib import Path


def getBuildBranch():
	try:
		branch = Path(__file__).with_name("build_branch").read_text(encoding="utf-8").strip()
	except OSError:
		return ""
	return escape(branch)
