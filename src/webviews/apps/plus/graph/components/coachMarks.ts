import type { TemplateResult } from 'lit';
import { html } from 'lit';
import type { GraphCoachMarkType } from '../../../../plus/graph/protocol.js';

export interface GraphCoachMarkContent {
	title: string;
	body: () => TemplateResult;
	/** Same-frame arbitration when multiple marks trigger together — higher wins; the loser is
	 *  queued and opens when the winner closes. */
	priority: number;
}

/** Copy is transcribed from the spec in https://github.com/gitkraken/vscode-gitlens/issues/5516.
 *  Where the spec's text opens with a bold lead-in (e.g. `**AI Review** — …`) that lead-in becomes
 *  the `title` and the remainder the `body`, so the card keeps its title row. */
export const graphCoachMarks: Record<GraphCoachMarkType, GraphCoachMarkContent> = {
	details: {
		title: 'Commit Details',
		priority: 1,
		body: () =>
			html`<p>Select a commit, multiple rows, or your working changes to see the details and next steps here.</p>
				<p>
					Then go further — <strong>Review</strong> changes with AI, <strong>Compose</strong> a WIP into clean
					commits, or <strong>Compare</strong> any two refs.
				</p>`,
	},
	compose: {
		title: 'Compose Commits with AI',
		priority: 2,
		body: () =>
			html`<p>Turn a messy WIP or history into clean, reviewable commits.</p>
				<ol>
					<li>Drag to pick the scope of changes and select specific files to include</li>
					<li>Click <strong>Compose</strong> - AI will group your changes into draft commits</li>
					<li>Drag files or reorder commits, regenerate a message if needed</li>
					<li>Commit Changes when it looks right</li>
				</ol>`,
	},
	review: {
		title: 'AI Review',
		priority: 2,
		body: () =>
			html`<p>Catch issues before you push, right where you're already looking at the changes.</p>
				<p>
					Pick a scope and click <strong>Start Review</strong> — findings come back tagged Critical, Warning,
					or Suggestion by focus area. Send to an Agent to fix one, or send the whole review.
				</p>`,
	},
	conflicts: {
		title: 'Conflicts Detected',
		priority: 3,
		body: () =>
			html`<p>The conflicting files are listed below — open one to see exactly what's colliding.</p>
				<p>
					Or skip the manual diffing: select <strong>Resolve conflicts</strong> above to have AI propose a fix
					for every file at once.
				</p>`,
	},
	resolve: {
		title: 'Resolve Conflicts with AI',
		priority: 3,
		body: () =>
			html`<p>Let AI propose a resolution for each file instead of untangling every hunk by hand.</p>
				<p>
					Check the files to resolve, review each result under <strong>Resolved</strong> or
					<strong>Needs your input</strong>, then <strong>Apply Resolution</strong>.
				</p>`,
	},
	agents: {
		title: 'Manage your Agents in Context',
		priority: 1,
		body: () =>
			html`<p>
					Every running agent session with status, grouped by worktree, so you always know what needs your
					attention.
				</p>
				<p>
					Keep tabs on <em>Working</em> and <em>Idle</em> sessions, and when a session <em>Needs Input</em> it
					can be approved, denied, or opened right from here or the details panel.
				</p>`,
	},
	compare: {
		title: 'Compare Any Two Refs',
		priority: 2,
		body: () =>
			html`<p>See exactly what changed between any branch, tag, or commit — and your working changes too.</p>
				<p>
					Set a <strong>Base</strong> and <strong>Compare</strong> ref, then check
					<strong>Ahead/Behind</strong> for commits or <strong>All Files</strong> for the raw diff.
				</p>`,
	},
};
