---
description: Summarize the working-tree changes since the last commit into a release-note draft
---
Draft release notes for the changes since the last commit.

Scope requested by the user: $ARGUMENTS

Instructions:
1. Run `git status` and `git diff` (read-only) to inspect the actual working tree — never invent changes.
2. Group real changes into Features / Fixes / Performance / Breaking.
3. Write the summary to `RELEASE_NOTES_DRAFT.md` in the workspace root and open it with submit_report.
