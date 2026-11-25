# Trace prompt: which release introduced this bug?

You are one of several **independent** tracers. Others trace the same bug without seeing your answer, and the result is only used if you agree. Work from evidence in git and the issue. Don't guess to be helpful: a wrong release is worse than an honest `low`.

Inputs, filled in by the skill:

- Repo: the GitLens repo at the current working directory.
- Issue: `#{number}`, {title}, {url}
- Fix commit(s): {fixCommits}

Rules:

- Read-only. Never run a git command that changes anything (no checkout, commit, stash, reset or branch). `git fetch` is fine.
- Read GitHub only through REST `gh api repos/gitkraken/vscode-gitlens/issues/{number}` and `/comments`, at most once each. No GraphQL, no `gh issue`.
- Don't dispatch subagents. Don't edit files.
- Stay blind: don't read anything under `.work/` or `.superpowers/`, and don't open other tracers' output or saved ledger data. Those hold earlier answers, and your trace only counts if it's independent.

## Method

1. **Understand the defect.** Read the issue and its comments, then the fix diff (`git show <fix>`). State in one sentence what was wrong with GitLens's behaviour.
2. **Find the defective code.** Find the lines that embodied the defect in the fix's parent (`<fix>^`): the lines the fix removed or changed, or, when the fix only adds code, the existing code that lacked the guard or handling the fix added.
3. **Find where that behaviour began.** Run `git blame -w -M -C <fix>^ -- <file>` on those lines. Then check every commit blame returns:
   - **A move, rename, reorganization, or a large mechanical or WIP commit is not an origin.** Follow it back (`git log -L`, `git log -S'<snippet>'`, `git log --follow`) until you reach the commit where the defective _behaviour_ first appeared.
   - **Copied code:** if the defective pattern was copied from somewhere else, the origin for this issue is where the defect first reached **the surface this issue reports**, not an earlier copy in an unrelated feature. Mention the earlier copy in `notes`.
   - **What counts as the surface:** the feature the issue names, as users reach it, **including earlier versions of that feature** (an older view or panel that showed the same thing for the same user action before a redesign). The question is: what's the first stable release in which a user could hit this reported behaviour? Check that release's source to confirm the behaviour was really there, and that whatever it depends on (a setting, a command) existed then.
   - **Replayed duplicates:** the same change can exist under several hashes. Report the hash you found. The skill maps all copies.
4. **Classify:**
   - `introduced`: GitLens shipped defective code. This includes **latent defects that an outside condition exposes** (another extension's timing, an OS or shell quirk, a slow external CLI). Our code was wrong, so it counts against the commit that shipped it.
   - `external`: GitLens's relevant behaviour didn't change. The outside world did (a hosting provider changed its URLs or hosts, an API was retired). The fix adapts to the new world.
   - `not-a-gitlens-bug`: the problem isn't a defect in GitLens at all (user configuration, another tool's bug, working as designed), even though a commit touched it. This also covers defects only in development tooling that never ships in the extension: build or lint scripts, tests, CI.
5. **Confidence:**
   - `high`: blame plus follow-up lands cleanly on a small commit that clearly introduced the behaviour.
   - `medium`: you had to reason across moves or copies, or the defect is a missing guard.
   - `low`: you couldn't isolate the origin, or the classification itself is uncertain.

## Answer

End your reply with exactly one fenced JSON block, with nothing after it:

```json
{
	"classification": "introduced",
	"introducingCommits": ["<full 40-char sha>"],
	"surface": "<the UI/feature/code path the issue is about>",
	"confidence": "high",
	"notes": "<one or two sentences: the defect, and why this commit is its origin>"
}
```

- For `introduced`, `introducingCommits` lists the commit that first shipped the defective behaviour, as a full SHA. If the defect only appeared once several commits were all present, list only the one that landed **last**: that's when it first existed. List more than one only when the issue reports several **independent** defects. The earliest of those counts (one issue is one count).
- For `external` and `not-a-gitlens-bug`, `introducingCommits` is `[]`.
