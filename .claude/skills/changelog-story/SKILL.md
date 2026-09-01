---
name: changelog-story
description: Reorganize the CHANGELOG's [Unreleased] section into a release "story" — pillar features become umbrella entries with sub-bullets, wording gets tightened to expert release-notes quality, and intra-release-only fixes get pruned by verifying against the last stable tag. Use whenever the user asks to make the changelog tell a story, reorganize/consolidate/group the unreleased section, prep the CHANGELOG for a release, or complains the unreleased section is too long, too detailed, or disorganized — even if they just say "clean up the changelog". Not for adding individual entries (that's /audit-commits or /commit).
---

# Changelog Story

Rewrite `[Unreleased]` in CHANGELOG.md as an expert release-notes writer: the release's headline features read as a handful of coherent stories, everything else is terse, and nothing claims more than the code actually does. This is a judgment-heavy writing task — do the rewrite yourself in the main loop; delegate only mechanical verification (tag greps, ref diffs).

## Inputs

- `CHANGELOG.md` `[Unreleased]` section — the material to rewrite
- The last stable tag (`git tag --sort=-creatordate | head -5`) — the baseline for "was this observable to users before?"
- Optional but valuable: a `/audit-commits` checklist in `.work/reviews/` — the commit-to-entry audit trail. If one exists for this range, absorb its still-unchecked missing entries during the rewrite rather than leaving two sources of truth.

**Know what this pass can't do:** it reorganizes what's already in the section — it cannot surface features that never got entries. If a pillar has no entry (the 18.4 engine rewrite famously had none), flag that to the user and suggest `/audit-commits` first, rather than silently telling a story with its headline missing. Likewise, without an audit trail your ability to catch _stale_ entries (an entry describing behavior a later commit changed) is limited to what git archaeology you do — say so in the report.

## Step 0 — Establish the pillars

Ask the user which 3–5 features are _the story of this release_ unless they already said. Everything else flows from this: pillars become umbrella entries at the top of Added, in the order given. Don't guess the pillars from entry sizes — the user knows what the release is about.

## Working rules (learned the hard way)

- **Re-read the section from disk immediately before every edit batch.** The user edits CHANGELOG.md concurrently in their IDE; stale anchors will miss or mangle. If an edit fails to anchor, that's the signal — re-read, don't retry.
- **Back up the old section** to your scratchpad before the first splice, so the user can diff or revert.
- **Never lose an issue reference.** Before rewriting, extract every `#NNNN` from the section; after, diff the sets. A dropped ref is only acceptable when the entire entry was deliberately cut — and then it goes in the "deliberately left out" report (below).

## The umbrella pattern

Each pillar becomes one top-level entry: a lede line that tells the story in plain language, then sub-bullets for the pieces. Example shape (from the 18.4 rewrite):

```markdown
- Adds a new home for GitLens — the _Commit Graph_ now leads the GitLens side bar as its main view (...), adapting to the side bar's width with compact rows and the details panel below ([#5545](...))
  - Adds empty states for no-repository and untrusted workspaces ([#5408](...))
  - Adds a sign-in experience with task-specific messaging ([#5534](...))
  - ...
```

Placement judgment:

- **Order everything by user-facing value.** Umbrellas follow the user's pillar order; within each section, standalone entries run highest-impact first (a reader who stops after three bullets should have seen the release's best three); within an umbrella, sub-bullets lead with the capability a user would care about most.
- **Value ordering never splits related entries.** Related things read together — a caveat next to the capability it qualifies, a pair of actions that share a surface, a follow-up next to its parent. Rank _clusters_ by their strongest member and keep each cluster's members adjacent (in descending value within the cluster, never by arrival order); don't interleave clusters just because a strict value sort would. Split a cluster only when one member genuinely belongs to a different story than its neighbors.
- **A third level is allowed for a feature-group inside an umbrella.** When an umbrella's story includes a cohesive feature-group that has its own details (e.g. "richer branch and tag pills" inside a broad graph-improvements umbrella), keep the group as one sub-bullet and push its details to a third level — that preserves both the umbrella's readability and the group's identity. Don't go deeper than three.
- **Beware accretion order.** Entries added incrementally (during an audit, or over days of landing work) end up in the order they were discovered, which is never the right reading order — after any batch of additions, re-audit the affected umbrella's ordering, not just the section's.
- **Order umbrellas so references flow downward** — if the stacked-PRs story references "the panel" and "the sheet", the PR-support umbrella that introduces them comes first (when this conflicts with the value order, references win — a story that names things not yet introduced reads broken).
- **Standalone features stay standalone.** An umbrella that absorbs everything vaguely related becomes a junk drawer and buries the features it swallowed. The test: does the sub-bullet belong to the umbrella's _story_, or does it merely touch the same surface? A PR details sheet belongs to the PR story even though it's technically a details-panel sheet.
- **Absorb duplicates.** When a full standalone entry repeats an umbrella's sub-bullet, delete the standalone; keep whichever wording is better and all refs from both.
- **Umbrellas live in Added (and occasionally Changed).** Don't umbrella Fixed entries — but do move a pillar's related fixes adjacent to each other so they read as a cluster (the five compose fixes sit together, the graph navigation fixes sit together).

## Write like an expert, not a diff

Bring an expert level of technical documentation and release-notes writing, with a touch of developer marketing. The reader is a developer skimming on release day: each entry must be parseable in one pass, and the good ones should make them want to try the feature. The failure mode to avoid is the "accurate but exhausting" entry — five clauses chained with em-dashes and semicolons that force the reader to re-read.

- **Benefit first, mechanics second.** Open with what the user can now do in plain words; the how comes after. "Adds a _Squash Fixups..._ action — squashes all pending fixup commits into their targets" beats leading with the git plumbing.
- **One idea per clause; three clauses is the ceiling.** If an entry needs a fourth clause, either split it into sub-bullets, move detail to a sub-bullet, or cut the detail. Semicolon chains are a smell.
- **Concrete user verbs.** "Right-click a session", "hover the _Pull_ button", "press `/`" — not "provides the ability to", not abstract nouns doing verb work.
- **Trailing parentheticals for the fine print.** Setting names, Git version requirements, and defaults go at the end in parentheses, never mid-sentence where they break the reading flow.
- **A touch of marketing means confidence, not hype.** Frame the benefit positively and lead with the strongest capability — but "central hub", "supercharges", "seamless" stay out. The line is: every claim survives a skeptical developer trying it.
- **"Adds" only for genuinely new**; **"Improves"** for enhancements to a feature that already shipped in the last stable (check the prior release's section before choosing). **"Changes" / "Fixes" / "Removes"** per Keep a Changelog. And check for miscast entries: a "Changes" that describes corrected wrong behavior is really a fix — verify the old behavior was observable at the tag, then move it to Fixed with a "Fixes" rewording.
- **UI names in underscores** (`_Commit Graph_`), issue refs as `([#NNNN](url))`, house style throughout — match the surrounding released sections.

## Verbosity cuts

Not every aspect of everything needs documenting. Targets:

- Mega-entries (6–12 dense lines) compress to 2–4 lines that keep the point and the refs.
- Merge natural pairs into one entry: pull+push previews, two paging fixes, two rename fixes — anything a user experiences as one improvement.
- Intra-release polish on a feature that is itself in `[Unreleased]` gets folded into (or covered by) the parent entry — never its own line.
- **Cut for criteria, not for size.** An entry is removed only when it fails a criterion (intra-release, not user-observable, duplicated by an umbrella) — never merely for being small. Small user-visible changes live on as terse one-liners in the section's long tail; a changelog with a long tail of small real improvements reads as a healthy release. The verbosity lever is wording, not entry count.

**Put-back rule:** anything with an issue number or a symptom a user actually reported/noticed goes back in, even after cuts. When in doubt between a cut and a one-liner, one-liner.

## Intra-release pruning

A Fixed/Changed entry earns its place only if the symptom was **observable on the last stable release**. If the bug was born and fixed inside this cycle, users never saw it — cut the entry.

- **Verify against the tag, never guess.** `git grep <symbol/setting/command-id> <tag> -- <paths>` or `git show <tag>:<file>` to prove the feature/code path existed at the tag. A fix to a feature that has zero hits at the tag is intra-release by definition.
- Common traps: a fix whose _area_ shipped but whose _specific path_ didn't (e.g. a fix to an AI action that was added this cycle inside a feature that shipped last cycle); an entry that appears in both the last release's section and `[Unreleased]` (figure out which cycle it actually shipped in — ask the user if git can't settle it).
- When a pruned "Changes" entry described how an unshipped feature behaves, fold its substance into that feature's Added entry — that's just how the feature ships.

## Accuracy — don't overclaim

Before wording any behavioral claim, verify it against the commit bodies or code. The canonical failure: a lane-stability bullet claimed "rebases and resets no longer shuffle lanes" when the actual fixes were narrower (fetches keep sticky layout; rewrites re-lay out _cleanly_). Enthusiastic summarization reads as lying in release notes. When compressing an entry, compress the words, not the truth.

## Close the loop — the gap audit

The rewrite only reorganizes existing entries; work that landed without one stays invisible. After the story pass (or when the user asks "are we missing anything"), run a gap audit: a subagent walks the commits since the tag (scoped to the user's own commits unless told otherwise), classifies each as user-facing or not, and semantically matches user-facing ones against the curated section — matching by meaning, since curation merged and compressed wording.

**Never apply an audit agent's findings unverified.** In practice every audit run has contained errors — features claimed missing that shipped at the tag (making them fixes, not adds), fixes claimed missing that were intra-release, items that already had entries. Verify each claimed gap independently (a second subagent or your own tag greps) before writing an entry, and require the audit to reconcile every commit into covered / missing / intra-release / not-user-facing so silent skips can't hide.

## Report back

End with:

1. Size delta (chars/entries before → after) and confirmation the issue-ref diff is clean (list any refs that moved entries).
2. How the story now reads — the umbrella order in one line each.
3. **Deliberately left out** — every cut entry that a user _might_ miss, flagged for veto. Highlight any cut that dropped an issue ref.
4. Anything you couldn't verify against the tag and the judgment call you made.

Expect iteration: the user will question specific bullets, put things back, ask for more grouping — and reshape the structure itself: a sub-bullet that's valuable on its own gets promoted to its own umbrella (with a fresh lede telling its broader story), umbrellas get reordered, and new umbrellas emerge that weren't in the pillar list. Treat the pillar list as a starting frame, not a contract. Each follow-up edit starts with a fresh read from disk.
