# Issue tracker

This repository uses GitHub Issues: `Juan23/pip-the-bot`, https://github.com/Juan23/pip-the-bot/issues.

- **Read:** `gh issue view <n> --repo Juan23/pip-the-bot --json number,title,body,labels,comments`
- **List:** `gh issue list --repo Juan23/pip-the-bot --state open`, with `--label` filters as needed.
- **Create or edit:** only when Juan asks for publication: `gh issue create` or `gh issue edit` against `Juan23/pip-the-bot`. The completion update below and the ownership label are standing exceptions.
- **Blocking edges:** `gh api --method POST repos/Juan23/pip-the-bot/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`. The id comes from `gh api repos/Juan23/pip-the-bot/issues/<n> --jq .id`, not the `#number`.
- **Labels:**
  - `ready-for-agent`: agent-ready tickets.
  - `in progress`: someone owns the issue. Add it before the first edit, and remove it when the issue closes or work stops. It needs no request.
  - `needs-review`: its PR is open.

GitHub shares one number space for issues and PRs, so resolve a bare `#n` with `gh issue view` first.

## Workflow

1. **Ownership.** Leave an issue that is already labelled `in progress` alone unless Juan says to take it over.
2. **One PR per ticket, straight to `main`.**
   - The first line of the body is `Closes #<n>`, and only when every acceptance criterion is verified. Otherwise it's `Part of #<n>`.
   - The body quotes each criterion with its verdict.
3. **Closing on main.** When the PR merges and every criterion is verified, with no confirmation needed:
   1. tick the criteria in the issue body
   2. post a dated comment with the verdict, the checks run and the `main` commit
   3. close the issue

   A ticket with anything unverified gets only the comment, naming what remains.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `Juan23/pip-the-bot`, under the publication rule above.
