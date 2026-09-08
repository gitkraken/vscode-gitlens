import * as l10n from '@vscode/l10n';
import type { TemplateResult } from 'lit';
import { html } from 'lit';
import { localizedContent } from '@gitlens/components/localizedContent.js';
import type { GraphCoachMarkType } from '../../../../plus/graph/protocol.js';

/** Host-supplied values a coach mark's body may interpolate; today only the scoped worktree's name. */
export interface GraphCoachMarkBodyContext {
	worktreeName?: string;
}

export interface GraphCoachMarkContent {
	title: string;
	/** code-icon name rendered as a tinted chip before the title. */
	icon?: string;
	/** Tint for the icon chip; defaults to the focus-border accent. */
	iconTone?: 'accent' | 'warning' | 'scoped';
	body: (context?: GraphCoachMarkBodyContext) => TemplateResult;
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
	title: l10n.t('Inspect Anything on the Graph'),
	icon: 'inspect',
	priority: 1,
	body: () =>
		html`<p class="lede">
				${l10n.t('Select anything — a commit, a range of rows, a branch, tag, or your WIP — and its changes, linked PRs, and next steps land here.')}
			</p>
			<div class="rows">
				<div class="row">
					<code-icon class="row__icon" icon="wand"></code-icon>
					<div class="row__body">
						${localizedContent(l10n.t({ message: '{compose} — turn a WIP into clean commits', comment: ['{compose} is the styled label “Compose”.'] }), { compose: html`<strong>${l10n.t('Compose')}</strong>` })}
					</div>
				</div>
				<div class="row">
					<code-icon class="row__icon" icon="checklist"></code-icon>
					<div class="row__body">
						${localizedContent(l10n.t({ message: '{review} — AI-check changes before you push', comment: ['{review} is the styled label “Review”.'] }), { review: html`<strong>${l10n.t('Review')}</strong>` })}
					</div>
				</div>
				<div class="row">
					<code-icon class="row__icon" icon="compare-changes"></code-icon>
					<div class="row__body">
						${localizedContent(l10n.t({ message: '{compare} — diff any two refs', comment: ['{compare} is the styled label “Compare”.'] }), { compare: html`<strong>${l10n.t('Compare')}</strong>` })}
					</div>
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
		title: l10n.t('Compose Commits with AI'),
		icon: 'wand',
		priority: 2,
		trust: l10n.t('Nothing touches your history until you confirm.'),
		body: () =>
			html`<p class="lede">
					${l10n.t('Turn a messy WIP — or a stretch of history — into clean, reviewable commits.')}
				</p>
				<div class="steps">
					<div class="step">
						<span class="step__num">1</span>
						<div class="step__body">
							${l10n.t('Pick your scope — drag across commits, check specific files')}
						</div>
					</div>
					<div class="step">
						<span class="step__num">2</span>
						<div class="step__body">
							${localizedContent(l10n.t({ message: '{compose} — AI groups your changes into draft commits', comment: ['{compose} is the styled label “Compose”.'] }), { compose: html`<span class="chip">${l10n.t('Compose')}</span>` })}
						</div>
					</div>
					<div class="step">
						<span class="step__num">3</span>
						<div class="step__body">
							${localizedContent(l10n.t({ message: 'Refine, then {commitChanges} — reorder, move files, regenerate any message', comment: ['{commitChanges} is the styled label “Commit Changes”.'] }), { commitChanges: html`<span class="chip">${l10n.t('Commit Changes')}</span>` })}
						</div>
					</div>
				</div>`,
	},
	review: {
		title: l10n.t('Review Changes with AI'),
		icon: 'checklist',
		priority: 2,
		body: () =>
			html`<p class="lede">${l10n.t('Catch issues before you push — right where the changes live.')}</p>
				<div class="steps">
					<div class="step">
						<span class="step__num">1</span>
						<div class="step__body">
							${l10n.t('Pick your scope — drag across commits, check specific files')}
						</div>
					</div>
					<div class="step">
						<span class="step__num">2</span>
						<div class="step__body">
							${localizedContent(l10n.t('{startReview} — findings come back ranked:'), { startReview: html`<span class="chip">${l10n.t('Start Review')}</span>` })}
							<div class="rows">
								<div class="row">
									<span class="dot dot--critical"></span>
									<div class="row__body">
										${localizedContent(l10n.t({ message: '{critical} — fix before pushing', comment: ['{critical} is the styled label “Critical”.'] }), { critical: html`<strong>${l10n.t('Critical')}</strong>` })}
									</div>
								</div>
								<div class="row">
									<span class="dot dot--warning"></span>
									<div class="row__body">
										${localizedContent(l10n.t({ message: '{warning} — worth a look', comment: ['{warning} is the styled label “Warning”.'] }), { warning: html`<strong>${l10n.t('Warning')}</strong>` })}
									</div>
								</div>
								<div class="row">
									<span class="dot dot--suggestion"></span>
									<div class="row__body">
										${localizedContent(l10n.t({ message: '{suggestion} — nice to have', comment: ['{suggestion} is the styled label “Suggestion”.'] }), { suggestion: html`<strong>${l10n.t('Suggestion')}</strong>` })}
									</div>
								</div>
							</div>
						</div>
					</div>
					<div class="step">
						<span class="step__num">3</span>
						<div class="step__body">
							${l10n.t('Send one finding — or the whole review — to your agent to fix')}
						</div>
					</div>
				</div>`,
	},
	conflicts: {
		title: l10n.t('Conflicts Detected'),
		icon: 'warning',
		iconTone: 'warning',
		priority: 3,
		body: () =>
			html`<p class="lede">${l10n.t('This operation paused on conflicts. Two ways forward:')}</p>
				<div class="rows">
					<div class="row row--block">
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{letAITakeTheFirstPass} — {resolveConflicts} proposes a fix for every file at once; you approve each one.', comment: ['{letAITakeTheFirstPass} is the styled label “Let AI take the first pass”.', '{resolveConflicts} is the styled label “Resolve Conflicts”.'] }), { letAITakeTheFirstPass: html`<strong>${l10n.t('Let AI take the first pass')}</strong>`, resolveConflicts: html`<span class="chip">${l10n.t('Resolve Conflicts')}</span>` })}
						</div>
					</div>
					<div class="row row--block">
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{fixManually} — open any file below to see both sides.', comment: ['{fixManually} is the styled label “Fix manually”.'] }), { fixManually: html`<strong>${l10n.t('Fix manually')}</strong>` })}
						</div>
					</div>
				</div>`,
	},
	resolve: {
		title: l10n.t('Resolve Conflicts with AI'),
		icon: 'gl-merge',
		priority: 3,
		trust: l10n.t('Nothing is applied until you approve it.'),
		body: () =>
			html`<p class="lede">
					${l10n.t('AI proposes a resolution for every conflicted file — instead of you untangling each hunk by hand.')}
				</p>
				<div class="steps">
					<div class="step">
						<span class="step__num">1</span>
						<div class="step__body">
							${localizedContent(l10n.t({ message: 'Check the files to include, then {resolve}', comment: ['{resolve} is the styled label “Resolve”.'] }), { resolve: html`<span class="chip">${l10n.t('Resolve')}</span>` })}
						</div>
					</div>
					<div class="step">
						<span class="step__num">2</span>
						<div class="step__body">
							${localizedContent(l10n.t({ message: 'Review each result under {resolved} and {needsYourInput}', comment: ['{resolved} is the styled label “Resolved”.', '{needsYourInput} is the styled label “Needs your input”.'] }), { resolved: html`<span class="chip chip--ui">${l10n.t('Resolved')}</span>`, needsYourInput: html`<span class="chip chip--ui">${l10n.t('Needs your input')}</span>` })}
						</div>
					</div>
					<div class="step">
						<span class="step__num">3</span>
						<div class="step__body">
							${localizedContent(l10n.t({ message: '{applyResolutions} updates and stages the files', comment: ['{applyResolutions} is the styled label “Apply Resolutions”.'] }), { applyResolutions: html`<span class="chip">${l10n.t('Apply Resolutions')}</span>` })}
						</div>
					</div>
				</div>`,
	},
	composeReady: {
		title: l10n.t('Your Draft Commits Are Ready'),
		icon: 'settings',
		priority: 2,
		trust: l10n.t('Nothing touches your history until you confirm.'),
		body: () =>
			html`<p class="lede">
					${l10n.t('AI grouped your changes into draft commits — now shape them however you like:')}
				</p>
				<div class="rows">
					<div class="row">
						<code-icon class="row__icon" icon="circle-slash"></code-icon>
						<div class="row__body">
							${l10n.t('Uncheck a draft commit to leave it out — its changes stay in your working tree')}
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="gripper"></code-icon>
						<div class="row__body">${l10n.t('Reorder commits, or drag files between them')}</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="refresh"></code-icon>
						<div class="row__body">
							${localizedContent(l10n.t({ message: 'Not quite right? {recomposeChanges} with feedback', comment: ['{recomposeChanges} is the styled label “Recompose Changes”.'] }), { recomposeChanges: html`<span class="chip">${l10n.t('Recompose Changes')}</span>` })}
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="arrow-right"></code-icon>
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{commitChanges} when it reads right', comment: ['{commitChanges} is the styled label “Commit Changes”.'] }), { commitChanges: html`<span class="chip">${l10n.t('Commit Changes')}</span>` })}
						</div>
					</div>
				</div>`,
	},
	resolveReady: {
		title: l10n.t('Resolutions Ready for Review'),
		icon: 'gl-merge',
		priority: 3,
		trust: l10n.t('Nothing is applied until you approve it.'),
		body: () =>
			html`<p class="lede">${l10n.t("AI took its pass at every file — now it's your call:")}</p>
				<div class="rows">
					<div class="row">
						<span class="dot dot--success"></span>
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{resolved} — clean proposals; open a file to inspect the result', comment: ['{resolved} is the styled label “Resolved”.'] }), { resolved: html`<strong>${l10n.t('Resolved')}</strong>` })}
						</div>
					</div>
					<div class="row">
						<span class="dot dot--attention"></span>
						<div class="row__body">
							${localizedContent(l10n.t({ message: "{needsYourInput} — AI wasn't confident; give these your eyes first", comment: ['{needsYourInput} is the styled label “Needs your input”.'] }), { needsYourInput: html`<strong>${l10n.t('Needs your input')}</strong>` })}
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="refresh"></code-icon>
						<div class="row__body">
							${localizedContent(l10n.t({ message: 'Not right? {refineResolutions} with feedback', comment: ['{refineResolutions} is the styled label “Refine Resolutions”.'] }), { refineResolutions: html`<span class="chip">${l10n.t('Refine Resolutions')}</span>` })}
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="arrow-right"></code-icon>
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{applyResolutions} updates and stages the files', comment: ['{applyResolutions} is the styled label “Apply Resolutions”.'] }), { applyResolutions: html`<span class="chip">${l10n.t('Apply Resolutions')}</span>` })}
						</div>
					</div>
				</div>`,
	},
	agents: {
		title: l10n.t('Every Agent, at a Glance'),
		icon: 'robot',
		priority: 1,
		body: () =>
			html`<p class="lede">
					${l10n.t('All of your agent sessions, live and grouped by worktree — see and review their work without switching context.')}
				</p>
				<div class="rows">
					<div class="row">
						<span class="dot dot--success"></span>
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{working} — heads-down; nothing to do', comment: ['{working} is the styled label “Working”.'] }), { working: html`<strong>${l10n.t('Working')}</strong>` })}
						</div>
					</div>
					<div class="row">
						<span class="dot dot--muted"></span>
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{idle} — finished or awaiting direction', comment: ['{idle} is the styled label “Idle”.'] }), { idle: html`<strong>${l10n.t('Idle')}</strong>` })}
						</div>
					</div>
					<div class="row">
						<span class="dot dot--attention"></span>
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{needsInput} — approve, deny, or open it right here', comment: ['{needsInput} is the styled label “Needs Input”.'] }), { needsInput: html`<strong>${l10n.t('Needs Input')}</strong>` })}
						</div>
					</div>
				</div>`,
	},
	compare: {
		title: l10n.t('Compare Any Two Refs'),
		icon: 'compare-changes',
		priority: 2,
		body: () =>
			html`<p class="lede">
					${l10n.t('See what actually changed between any two points — branch vs main, tag to tag, or your WIP.')}
				</p>
				<p>
					${localizedContent(l10n.t({ message: 'Set a {base} and a {compare} ref, then pick a tab:', comment: ['{base} is the styled label “Base”.', '{compare} is the styled label “Compare”.'] }), { base: html`<span class="chip chip--ui">${l10n.t('Base')}</span>`, compare: html`<span class="chip chip--ui">${l10n.t('Compare')}</span>` })}
				</p>
				<div class="rows">
					<div class="row row--block">
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{ahead} — what Compare added', comment: ['{ahead} is the styled label “Ahead”.'] }), { ahead: html`<span class="chip chip--ui">${l10n.t('Ahead')}</span>` })}
						</div>
					</div>
					<div class="row row--block">
						<div class="row__body">
							${localizedContent(l10n.t({ message: "{behind} — what it's missing from Base", comment: ['{behind} is the styled label “Behind”.'] }), { behind: html`<span class="chip chip--ui">${l10n.t('Behind')}</span>` })}
						</div>
					</div>
					<div class="row row--block">
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{allFiles} — everything, as one diff', comment: ['{allFiles} is the styled label “All Files”.'] }), { allFiles: html`<span class="chip chip--ui">${l10n.t('All Files')}</span>` })}
						</div>
					</div>
				</div>
				<p class="footnote">
					${localizedContent(l10n.t({ message: 'Swap {filesChanged} for {contributors} to see who did the work.', comment: ['{filesChanged} is the styled label “Files Changed”.', '{contributors} is the styled label “Contributors”.'] }), { filesChanged: html`<span class="chip chip--ui">${l10n.t('Files Changed')}</span>`, contributors: html`<span class="chip chip--ui">${l10n.t('Contributors')}</span>` })}
				</p>`,
	},
	// Same tier as `details` — whichever arms first shows first, the other queues.
	overviewBar: {
		title: l10n.t('Track Every Worktree from Here'),
		icon: 'gl-worktree',
		// Below `details` so a first open shows the details tip first — this one stays queued and
		// opens once that closes.
		priority: 0,
		// The "Double-click" row below is static text describing the default
		// `graph.doubleClickWorktreeAction`: these marks are for new users, so a changed setting isn't tracked.
		body: () =>
			html`<p class="lede">
					${l10n.t('Each pill is a worktree — its changes, its agents, its branch — one click from anywhere.')}
				</p>
				<div class="rows">
					<div class="row">
						<code-icon class="row__icon" icon="arrow-right"></code-icon>
						<div class="row__body">
							${l10n.t("Click a pill to jump to that worktree's working changes")}
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="gl-scope"></code-icon>
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{doubleClick} a pill to scope the graph to that worktree', comment: ['{doubleClick} is the styled label “Double-click”.'] }), { doubleClick: html`<strong>${l10n.t('Double-click')}</strong>` })}
						</div>
					</div>
					<div class="row">
						<span class="dot dot--dirty"></span>
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{dot} — uncommitted changes sitting there', comment: ['{dot} is the styled label “Dot”.'] }), { dot: html`<strong>${l10n.t('Dot')}</strong>` })}
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="robot"></code-icon>
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{robot} — live agent sessions, with a count', comment: ['{robot} is the styled label “Robot”.'] }), { robot: html`<strong>${l10n.t('Robot')}</strong>` })}
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="target"></code-icon>
						<div class="row__body">
							${l10n.t('The markers beneath jump to HEAD, upstream, or the merge target')}
						</div>
					</div>
				</div>
				<p class="footnote">${l10n.t('Digits 1–9 and 0 jump to recent worktrees.')}</p>`,
	},
	kanban: {
		title: l10n.t('Your Agents, on a Board'),
		icon: 'gl-kanban-view',
		priority: 2,
		body: () =>
			html`<p class="lede">${l10n.t('Every agent session is a card, columned by what it needs from you.')}</p>
				<div class="rows">
					<div class="row">
						<span class="dot dot--attention"></span>
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{needsInput} — approve, deny, or answer right on the card', comment: ['{needsInput} is the styled label “Needs Input”.'] }), { needsInput: html`<strong>${l10n.t('Needs Input')}</strong>` })}
						</div>
					</div>
					<div class="row">
						<span class="dot dot--success"></span>
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{working} — heads-down; check back later', comment: ['{working} is the styled label “Working”.'] }), { working: html`<strong>${l10n.t('Working')}</strong>` })}
						</div>
					</div>
					<div class="row">
						<span class="dot dot--muted"></span>
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{idle} / {inactive} — awaiting direction, or wound down', comment: ['{idle} is the styled label “Idle”.', '{inactive} is the styled label “Inactive”.'] }), { idle: html`<strong>${l10n.t('Idle')}</strong>`, inactive: html`<strong>${l10n.t('Inactive')}</strong>` })}
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="arrow-right"></code-icon>
						<div class="row__body">
							${l10n.t("Click a card to see that session's changes — without leaving the board")}
						</div>
					</div>
				</div>`,
	},
	visualizations: {
		title: l10n.t('Visualizations & Health'),
		icon: 'pulse',
		priority: 2,
		body: () =>
			html`<p class="lede">
					${l10n.t("Your repo, visualized — history over time, hot spots in the tree, live agent activity, and the repo's own health.")}
				</p>
				<div class="rows">
					<div class="row">
						<code-icon class="row__icon" icon="graph-scatter"></code-icon>
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{visualHistory} — every commit plotted across time', comment: ['{visualHistory} is the styled label “Visual History”.'] }), { visualHistory: html`<strong>${l10n.t('Visual History')}</strong>` })}
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="folder"></code-icon>
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{filesTreemap} — your tree, sized by file size', comment: ['{filesTreemap} is the styled label “Files Treemap”.'] }), { filesTreemap: html`<strong>${l10n.t('Files Treemap')}</strong>` })}
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="git-commit"></code-icon>
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{commitsTreemap} — heat shows where the churn lives', comment: ['{commitsTreemap} is the styled label “Commits Treemap”.'] }), { commitsTreemap: html`<strong>${l10n.t('Commits Treemap')}</strong>` })}
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="robot"></code-icon>
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{agentActivityTreemap} — files light up as agents read and edit them', comment: ['{agentActivityTreemap} is the styled label “Agent Activity Treemap”.'] }), { agentActivityTreemap: html`<strong>${l10n.t('Agent Activity Treemap')}</strong>` })}
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="heart"></code-icon>
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{repositoryHealth} — one-click tune-ups that keep git fast', comment: ['{repositoryHealth} is the styled label “Repository Health”.'] }), { repositoryHealth: html`<strong>${l10n.t('Repository Health')}</strong>` })}
						</div>
					</div>
				</div>
				<p class="footnote">
					${l10n.t("Flip views with the switcher — click into any chart to open what it's drawn from.")}
				</p>`,
	},
	gitHealth: {
		title: l10n.t('Keep This Repo Fast'),
		icon: 'heart',
		priority: 2,
		trust: l10n.t('Nothing is applied without you — and anything GitLens applies can be undone.'),
		body: () =>
			html`<p class="lede">
					${l10n.t("GitLens checks this repository against git's performance features and suggests the ones worth turning on.")}
				</p>
				<div class="rows">
					<div class="row">
						<code-icon class="row__icon" icon="dashboard"></code-icon>
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{suggested} — optimizations this repo would benefit from', comment: ['{suggested} is the styled label “Suggested”.'] }), { suggested: html`<strong>${l10n.t('Suggested')}</strong>` })}
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="tools"></code-icon>
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{runMaintenanceNow} — repack, prune, and refresh caches on demand', comment: ['{runMaintenanceNow} is the styled label “Run Maintenance Now”.'] }), { runMaintenanceNow: html`<span class="chip">${l10n.t('Run Maintenance Now')}</span>` })}
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="list-unordered"></code-icon>
						<div class="row__body">
							${localizedContent(l10n.t({ message: "{optimizations} — each one's state, who set it, and Undo for anything GitLens applied", comment: ['{optimizations} is the styled label “Optimizations”.'] }), { optimizations: html`<strong>${l10n.t('Optimizations')}</strong>` })}
						</div>
					</div>
				</div>`,
	},
	// Fires right after the follow-terminal controller moves the selection — announces something that
	// just happened, so it must win same-frame arbitration against every other mark.
	followTerminal: {
		title: l10n.t('Following Your Active Terminal'),
		icon: 'terminal',
		priority: 4,
		lightbulb: false,
		action: { label: l10n.t('Turn Off'), command: 'gitlens.graph.followTerminalOff' },
		body: () =>
			html`<p class="lede">
					${l10n.t('The graph selected the working changes for the worktree your active terminal — or Claude Code tab — is in.')}
				</p>
				<p class="footnote">
					${l10n.t('Switching terminals keeps it in step. Turn this off anytime from the view\'s overflow menu ("Stop Following Active Terminal").')}
				</p>`,
	},
	worktreeScoped: {
		title: l10n.t("You're Scoped to a Worktree"),
		icon: 'gl-scope',
		iconTone: 'scoped',
		// Event-style: opens the first time a worktree scope lands, so there's no chrome home for a bulb.
		lightbulb: false,
		priority: 3,
		body: context =>
			html`<p class="lede">
					${localizedContent(l10n.t('The graph now acts as if you had opened {worktree}: you see its branch and its changes, and anything you commit, push, or pull happens there.'), { worktree: html`<strong>${context?.worktreeName ?? l10n.t('that worktree')}</strong>` })}
				</p>
				<div class="rows">
					<div class="row">
						<code-icon class="row__icon row__icon--scoped" icon="gl-scope"></code-icon>
						<div class="row__body">
							${l10n.t("Yellow marks what's scoped — the pill here, and the worktree's row in the sidebar")}
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="gl-unscope"></code-icon>
						<div class="row__body">
							${localizedContent(l10n.t({ message: "{unscope} — this glyph on the pill, or the same one on the worktree's row", comment: ['{unscope} is the styled label “Unscope”.'] }), { unscope: html`<strong>${l10n.t('Unscope')}</strong>` })}
						</div>
					</div>
					<div class="row">
						<code-icon class="row__icon" icon="target"></code-icon>
						<div class="row__body">
							${localizedContent(l10n.t({ message: '{focusOnBranch} only narrows the rows — nothing else changes', comment: ['{focusOnBranch} is the styled label “Focus on Branch”.'] }), { focusOnBranch: html`<span class="chip chip--ui">${l10n.t('Focus on Branch')}</span>` })}
						</div>
					</div>
				</div>
				<p class="footnote">${l10n.t('Double-click any worktree pill or row to scope to it.')}</p>`,
	},
};
