import type { TemplateResult } from 'lit';
import { html } from 'lit';
import type { GraphCoachMarkType } from '../../../../plus/graph/protocol.js';

export interface GraphCoachMarkContent {
	title: string;
	/** code-icon name rendered as a tinted chip before the title. */
	icon?: string;
	/** Tint for the icon chip; defaults to the focus-border accent. */
	iconTone?: 'accent' | 'warning';
	body: () => TemplateResult;
	/** Muted reassurance line pinned between the body and the actions row. */
	trust?: string;
	/** Same-frame arbitration when multiple marks trigger together — higher wins; the loser is
	 *  queued and opens when the winner closes. */
	priority: number;
	/** Optional second action rendered before "Got it". `command` is the host command the graph app
	 *  executes when it's pressed — content declares the behavior so the app needs no per-mark
	 *  dispatch; the click mechanics (telemetry, dismissal, event dispatch) live in
	 *  `gl-graph-coachmark`. */
	action?: { label: string; command: string };
	/** `false` = no parked lightbulb and no ✕: Esc/outside-click only defer the tip to the next
	 *  session (`seen` never banks) — pressing a button is the only permanent ending. For event
	 *  announcements that warrant an explicit choice and have no chrome home for a bulb. */
	lightbulb?: boolean;
}

const detailsContent: GraphCoachMarkContent = {
	title: 'Inspect Anything on the Graph',
	icon: 'inspect',
	priority: 1,
	body: () =>
		html`<p class="lede">
				Select anything — a commit, a range of rows, a branch, tag, or your WIP — and its changes, linked PRs,
				and next steps land here.
			</p>
			<div class="rows">
				<div class="row">
					<code-icon class="row__icon" icon="wand"></code-icon>
					<div class="row__body"><strong>Compose</strong> — turn a WIP into clean commits</div>
				</div>
				<div class="row">
					<code-icon class="row__icon" icon="checklist"></code-icon>
					<div class="row__body"><strong>Review</strong> — AI-check changes before you push</div>
				</div>
				<div class="row">
					<code-icon class="row__icon" icon="compare-changes"></code-icon>
					<div class="row__body"><strong>Compare</strong> — diff any two refs</div>
				</div>
			</div>`,
};

/** Copy follows the redesigned coach-mark spec (originally transcribed from
 *  https://github.com/gitkraken/vscode-gitlens/issues/5516). */
export const graphCoachMarks: Record<GraphCoachMarkType, GraphCoachMarkContent> = {
	// One shared tip, mounted on all three details surfaces (WIP header, commit panel, multi-commit
	// panel): the popover auto-shows once — whichever surface is up first claims it — and the
	// lightbulb parks on every surface until the tip is dismissed for good.
	details: detailsContent,
	compose: {
		title: 'Compose Commits with AI',
		icon: 'wand',
		priority: 2,
		trust: 'Nothing touches your history until you confirm.',
		body: () =>
			html`<p class="lede">Turn a messy WIP — or a stretch of history — into clean, reviewable commits.</p>
				<div class="steps">
					<div class="step">
						<span class="step__num">1</span>
						<div class="step__body">Pick your scope — drag across commits, check specific files</div>
					</div>
					<div class="step">
						<span class="step__num">2</span>
						<div class="step__body">
							<span class="chip">Compose</span> — AI groups your changes into draft commits
						</div>
					</div>
					<div class="step">
						<span class="step__num">3</span>
						<div class="step__body">
							Refine, then <span class="chip">Commit Changes</span> — reorder, move files, regenerate any
							message
						</div>
					</div>
				</div>`,
	},
	review: {
		title: 'Review Changes with AI',
		icon: 'checklist',
		priority: 2,
		body: () =>
			html`<p class="lede">Catch issues before you push — right where the changes live.</p>
				<div class="steps">
					<div class="step">
						<span class="step__num">1</span>
						<div class="step__body">Pick your scope — drag across commits, check specific files</div>
					</div>
					<div class="step">
						<span class="step__num">2</span>
						<div class="step__body">
							<span class="chip">Start Review</span> — findings come back ranked:
							<div class="rows">
								<div class="row">
									<span class="dot dot--critical"></span>
									<div class="row__body"><strong>Critical</strong> — fix before pushing</div>
								</div>
								<div class="row">
									<span class="dot dot--warning"></span>
									<div class="row__body"><strong>Warning</strong> — worth a look</div>
								</div>
								<div class="row">
									<span class="dot dot--suggestion"></span>
									<div class="row__body"><strong>Suggestion</strong> — nice to have</div>
								</div>
							</div>
						</div>
					</div>
					<div class="step">
						<span class="step__num">3</span>
						<div class="step__body">Send one finding — or the whole review — to your agent to fix</div>
					</div>
				</div>`,
	},
	conflicts: {
		title: 'Conflicts Detected',
		icon: 'warning',
		iconTone: 'warning',
		priority: 3,
		body: () =>
			html`<p class="lede">This operation paused on conflicts. Two ways forward:</p>
				<div class="rows">
					<div class="row row--block">
						<div class="row__body">
							<strong>Let AI take the first pass</strong> — <span class="chip">Resolve Conflicts</span>
							proposes a fix for every file at once; you approve each one.
						</div>
					</div>
					<div class="row row--block">
						<div class="row__body">
							<strong>Fix manually</strong> — open any file below to see both sides.
						</div>
					</div>
				</div>`,
	},
	resolve: {
		title: 'Resolve Conflicts with AI',
		icon: 'gl-merge',
		priority: 3,
		trust: 'Nothing is applied until you approve it.',
		body: () =>
			html`<p class="lede">
					AI proposes a resolution for every conflicted file — instead of you untangling each hunk by hand.
				</p>
				<div class="steps">
					<div class="step">
						<span class="step__num">1</span>
						<div class="step__body">Check the files to include, then <span class="chip">Resolve</span></div>
					</div>
					<div class="step">
						<span class="step__num">2</span>
						<div class="step__body">
							Review each result under <span class="chip chip--ui">Resolved</span> and
							<span class="chip chip--ui">Needs your input</span>
						</div>
					</div>
					<div class="step">
						<span class="step__num">3</span>
						<div class="step__body">
							<span class="chip">Apply Resolutions</span> updates and stages the files
						</div>
					</div>
				</div>`,
	},
	composeReady: {
		title: 'Your Draft Commits Are Ready',
		icon: 'settings',
		priority: 2,
		trust: 'Nothing touches your history until you confirm.',
		body: () =>
			html`<p class="lede">AI grouped your changes into draft commits — now shape them however you like:</p>
				<div class="rows">
					<div class="row">
						<code-icon class="row__icon" icon="circle-slash"></code-icon>
						<div class="row__body">
							Uncheck a draft commit to leave it out — its changes stay in your working tree
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="gripper"></code-icon>
						<div class="row__body">Reorder commits, or drag files between them</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="refresh"></code-icon>
						<div class="row__body">
							Not quite right? <span class="chip">Recompose Changes</span> with feedback
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="arrow-right"></code-icon>
						<div class="row__body"><span class="chip">Commit Changes</span> when it reads right</div>
					</div>
				</div>`,
	},
	resolveReady: {
		title: 'Resolutions Ready for Review',
		icon: 'gl-merge',
		priority: 3,
		trust: 'Nothing is applied until you approve it.',
		body: () =>
			html`<p class="lede">AI took its pass at every file — now it's your call:</p>
				<div class="rows">
					<div class="row">
						<span class="dot dot--success"></span>
						<div class="row__body">
							<strong>Resolved</strong> — clean proposals; open a file to inspect the result
						</div>
					</div>
					<div class="row">
						<span class="dot dot--attention"></span>
						<div class="row__body">
							<strong>Needs your input</strong> — AI wasn't confident; give these your eyes first
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="refresh"></code-icon>
						<div class="row__body">
							Not right? <span class="chip">Refine Resolutions</span> with feedback
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="arrow-right"></code-icon>
						<div class="row__body">
							<span class="chip">Apply Resolutions</span> updates and stages the files
						</div>
					</div>
				</div>`,
	},
	agents: {
		title: 'Every Agent, at a Glance',
		icon: 'robot',
		priority: 1,
		body: () =>
			html`<p class="lede">
					All of your agent sessions, live and grouped by worktree — see and review their work without
					switching context.
				</p>
				<div class="rows">
					<div class="row">
						<span class="dot dot--success"></span>
						<div class="row__body"><strong>Working</strong> — heads-down; nothing to do</div>
					</div>
					<div class="row">
						<span class="dot dot--muted"></span>
						<div class="row__body"><strong>Idle</strong> — finished or awaiting direction</div>
					</div>
					<div class="row">
						<span class="dot dot--attention"></span>
						<div class="row__body"><strong>Needs Input</strong> — approve, deny, or open it right here</div>
					</div>
				</div>`,
	},
	compare: {
		title: 'Compare Any Two Refs',
		icon: 'compare-changes',
		priority: 2,
		body: () =>
			html`<p class="lede">
					See what actually changed between any two points — branch vs main, tag to tag, or your WIP.
				</p>
				<p>
					Set a <span class="chip chip--ui">Base</span> and a <span class="chip chip--ui">Compare</span> ref,
					then pick a tab:
				</p>
				<div class="rows">
					<div class="row row--block">
						<div class="row__body"><span class="chip chip--ui">Ahead</span> — what Compare added</div>
					</div>
					<div class="row row--block">
						<div class="row__body">
							<span class="chip chip--ui">Behind</span> — what it's missing from Base
						</div>
					</div>
					<div class="row row--block">
						<div class="row__body">
							<span class="chip chip--ui">All Files</span> — everything, as one diff
						</div>
					</div>
				</div>
				<p class="footnote">
					Swap <span class="chip chip--ui">Files Changed</span> for
					<span class="chip chip--ui">Contributors</span> to see who did the work.
				</p>`,
	},
	// Same tier as `details` — whichever arms first shows first, the other queues.
	overviewBar: {
		title: 'Track Every Worktree from Here',
		icon: 'gl-worktree',
		// Below `details` so a first open shows the details tip first — this one stays queued and
		// opens once that closes.
		priority: 0,
		body: () =>
			html`<p class="lede">
					Each pill is a worktree — its changes, its agents, its branch — one click from anywhere.
				</p>
				<div class="rows">
					<div class="row">
						<code-icon class="row__icon" icon="arrow-right"></code-icon>
						<div class="row__body">Click a pill to jump to that worktree's working changes</div>
					</div>
					<div class="row">
						<span class="dot dot--dirty"></span>
						<div class="row__body"><strong>Dot</strong> — uncommitted changes sitting there</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="robot"></code-icon>
						<div class="row__body"><strong>Robot</strong> — live agent sessions, with a count</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="target"></code-icon>
						<div class="row__body">The markers beneath jump to HEAD, upstream, or the merge target</div>
					</div>
				</div>
				<p class="footnote">Digits 1–9 jump to recent worktrees.</p>`,
	},
	kanban: {
		title: 'Your Agents, on a Board',
		icon: 'gl-kanban-view',
		priority: 2,
		body: () =>
			html`<p class="lede">Every agent session is a card, columned by what it needs from you.</p>
				<div class="rows">
					<div class="row">
						<span class="dot dot--attention"></span>
						<div class="row__body">
							<strong>Needs Input</strong> — approve, deny, or answer right on the card
						</div>
					</div>
					<div class="row">
						<span class="dot dot--success"></span>
						<div class="row__body"><strong>Working</strong> — heads-down; check back later</div>
					</div>
					<div class="row">
						<span class="dot dot--muted"></span>
						<div class="row__body">
							<strong>Idle</strong> / <strong>Inactive</strong> — awaiting direction, or wound down
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="arrow-right"></code-icon>
						<div class="row__body">
							Click a card to see that session's changes — without leaving the board
						</div>
					</div>
				</div>`,
	},
	visualizations: {
		title: 'Four Views of Your Repo',
		icon: 'pulse',
		priority: 2,
		body: () =>
			html`<p class="lede">
					Your repo, visualized — history over time, hot spots in the tree, and live agent activity.
				</p>
				<div class="rows">
					<div class="row">
						<code-icon class="row__icon" icon="graph-scatter"></code-icon>
						<div class="row__body"><strong>Visual History</strong> — every commit plotted across time</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="folder"></code-icon>
						<div class="row__body"><strong>Files Treemap</strong> — your tree, sized by file size</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="git-commit"></code-icon>
						<div class="row__body"><strong>Commits Treemap</strong> — heat shows where the churn lives</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="robot"></code-icon>
						<div class="row__body">
							<strong>Agent Activity Treemap</strong> — files light up as agents read and edit them
						</div>
					</div>
				</div>
				<p class="footnote">
					Flip views with the switcher — click into any chart to open what it's drawn from.
				</p>`,
	},
	// Fires right after the follow-terminal controller moves the selection — announces something that
	// just happened, so it must win same-frame arbitration against every other mark.
	followTerminal: {
		title: 'Following Your Active Terminal',
		icon: 'terminal',
		priority: 4,
		lightbulb: false,
		action: { label: 'Turn Off', command: 'gitlens.graph.followTerminalOff' },
		body: () =>
			html`<p class="lede">
					The graph selected the working changes for the worktree your active terminal — or Claude Code tab —
					is in.
				</p>
				<p class="footnote">
					Switching terminals keeps it in step. Turn this off anytime from the view's overflow menu ("Stop
					Following Active Terminal").
				</p>`,
	},
};
