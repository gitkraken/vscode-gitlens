import { html } from 'lit';

// Hand-composed UI patterns built from raw markup + --gl-* tokens only. No shared components,
// no direct --vscode-* reads, no hardcoded color — this is the composition test for the token
// system: real-looking UI, not swatches. Hover/selected states are pinned via modifier classes so
// every state is visible without interacting with the page.

// 7 rows (days) × 12 cols (weeks); values index the 11-stop ramp (0 = ramp-05 … 10 = ramp-95). A
// literal (not Math.random) dataset keeps renders stable across reloads/screenshots.
const HEATMAP: number[][] = [
	[0, 1, 2, 1, 3, 5, 4, 2, 1, 0, 1, 2],
	[1, 2, 4, 3, 6, 8, 6, 4, 2, 1, 2, 3],
	[2, 4, 6, 5, 8, 10, 8, 5, 3, 2, 4, 5],
	[1, 3, 5, 7, 9, 10, 7, 6, 4, 3, 5, 6],
	[0, 2, 4, 6, 7, 8, 5, 4, 6, 5, 7, 8],
	[1, 1, 3, 4, 5, 6, 3, 2, 4, 6, 8, 10],
	[0, 0, 1, 2, 3, 4, 2, 1, 2, 3, 5, 7],
];
const RAMP_STOPS = ['05', '10', '20', '30', '40', '50', '60', '70', '80', '90', '95'];

function renderHeatmapCells(): unknown {
	// grid-auto-flow: column fills each column (week) top-to-bottom before moving to the next, so
	// cells must be emitted column-major (week-major, then day) to land in the right grid cell.
	const rows = HEATMAP.length;
	const cols = HEATMAP[0].length;
	const cells: unknown[] = [];
	for (let col = 0; col < cols; col++) {
		for (let row = 0; row < rows; row++) {
			const stop = RAMP_STOPS[HEATMAP[row][col]];
			cells.push(html`<span class="heat-cell heat-cell--${stop}"></span>`);
		}
	}
	return cells;
}

function renderCommitCard(): unknown {
	return html`
		<article class="pattern">
			<h3 class="pattern__title">Commit card</h3>
			<div class="pattern__stage">
				<div class="commit-card">
					<div class="commit-card__header">
						<span class="commit-card__avatar" aria-hidden="true">ED</span>
						<span class="commit-card__author">Eric Doe</span>
						<span class="commit-card__timestamp">3 hours ago</span>
					</div>
					<p class="commit-card__message">Refactors blame gutter rendering for virtual documents</p>
					<div class="commit-card__meta">
						<span class="commit-card__sha">7c9d2e1</span>
						<span class="commit-card__files">12 files changed</span>
						<span class="commit-card__stats">
							<span class="commit-card__added">+38</span>
							<span class="commit-card__modified">~7</span>
							<span class="commit-card__removed">−15</span>
						</span>
					</div>
					<div class="commit-card__actions">
						<button type="button" class="pattern-btn pattern-btn--primary">Open Changes</button>
						<button type="button" class="pattern-btn pattern-btn--secondary">Copy SHA</button>
						<a href="#" class="pattern-link">View on GitHub</a>
					</div>
				</div>
			</div>
			<p class="pattern__tokens">
				surface-raised · border · fg / fg-muted / fg-subtle · surface-code · diff-added/modified/removed ·
				accent · accent-fg · accent-active · link
			</p>
		</article>
	`;
}

function renderFileList(): unknown {
	return html`
		<article class="pattern">
			<h3 class="pattern__title">File list</h3>
			<div class="pattern__stage">
				<div class="file-list">
					<div class="file-row">
						<span class="file-row__status file-row__status--modified">M</span>
						<span class="file-row__name">blameAnnotations.ts</span>
						<span class="file-row__path">src/annotations/</span>
					</div>
					<div class="file-row file-row--selected">
						<span class="file-row__status file-row__status--added">A</span>
						<span class="file-row__name">commitDetails.ts</span>
						<span class="file-row__path">src/webviews/commitDetails/</span>
					</div>
					<div class="file-row file-row--hover">
						<span class="file-row__status file-row__status--modified">M</span>
						<span class="file-row__name">gutterHeatmap.ts</span>
						<span class="file-row__path">src/annotations/</span>
					</div>
					<div class="file-row">
						<span class="file-row__status file-row__status--removed">D</span>
						<span class="file-row__name">lineTracker.ts</span>
						<span class="file-row__path">src/trackers/</span>
					</div>
					<div class="file-row">
						<span class="file-row__status file-row__status--modified">M</span>
						<span class="file-row__name">hovers.ts</span>
						<span class="file-row__path">src/hovers/</span>
						<span class="file-row__count">3</span>
					</div>
				</div>
			</div>
			<p class="pattern__tokens">
				border-subtle · surface-hover · surface-selected / surface-selected-fg · fg / fg-subtle ·
				diff-added/modified/removed · neutral-bg
			</p>
		</article>
	`;
}

function renderFormFields(): unknown {
	return html`
		<article class="pattern">
			<h3 class="pattern__title">Form fields</h3>
			<div class="pattern__stage">
				<div class="pattern-field-group">
					<label class="pattern-field">
						<span class="pattern-field__label">Default branch name</span>
						<input class="pattern-input" type="text" value="main" />
						<span class="pattern-field__help">Used when initializing new repositories.</span>
					</label>
					<label class="pattern-field">
						<span class="pattern-field__label">Commit message template</span>
						<input class="pattern-input pattern-input--invalid" type="text" value="\${message" />
						<span class="pattern-field__error">Unclosed token — expected }</span>
					</label>
					<label class="pattern-field__checkbox">
						<input type="checkbox" checked />
						Show blame annotations on file open
					</label>
					<label class="pattern-field__checkbox pattern-field__checkbox--disabled">
						<input type="checkbox" disabled />
						Sync settings across devices (requires account)
					</label>
				</div>
			</div>
			<p class="pattern__tokens">
				surface-sunken · border · border-focus · fg / fg-muted / fg-disabled · danger / danger-bg · accent
			</p>
		</article>
	`;
}

function renderWorkList(): unknown {
	return html`
		<article class="pattern">
			<h3 class="pattern__title">Grouped work list</h3>
			<div class="pattern__stage">
				<div class="work-list">
					<div class="work-group">
						<div class="work-group__header">Needs your attention</div>
						<div class="work-row">
							<span class="work-row__title">Fix gutter blame flicker on scroll</span>
							<span class="work-row__ref">gitlens#4102</span>
							<span class="pattern-chip pattern-chip--danger">blocked</span>
							<span class="work-row__tracking work-row__tracking--ahead">↑3</span>
						</div>
						<div class="work-row">
							<span class="work-row__title">Add natural-language commit search</span>
							<span class="work-row__ref">gitlens#4097</span>
							<span class="pattern-chip pattern-chip--warning">review requested</span>
							<span class="work-row__tracking work-row__tracking--ahead">↑1</span>
							<span class="work-row__tracking work-row__tracking--behind">↓2</span>
						</div>
						<div class="work-row">
							<span class="work-row__title">Graph: lazy-load avatars</span>
							<span class="work-row__ref">gitlens#4088</span>
							<span class="pattern-chip pattern-chip--success">ready to merge</span>
						</div>
					</div>
					<div class="work-group">
						<div class="work-group__header">Waiting on others</div>
						<div class="work-row">
							<span class="work-row__title">Rebase editor keyboard nav</span>
							<span class="work-row__ref">gitlens#4075</span>
							<span class="pattern-chip pattern-chip--neutral">draft</span>
							<span class="work-row__tracking work-row__tracking--behind">↓4</span>
						</div>
					</div>
				</div>
			</div>
			<p class="pattern__tokens">
				fg-muted · fg-subtle · border-subtle · danger/-bg · warning/-bg · success/-bg · neutral-bg ·
				tracking-ahead · tracking-behind
			</p>
		</article>
	`;
}

function renderBrandAi(): unknown {
	return html`
		<article class="pattern">
			<h3 class="pattern__title">Brand &amp; AI</h3>
			<div class="pattern__stage">
				<div class="brand-card">
					<div class="brand-card__top">
						<span class="brand-card__title">GitLens Pro</span>
						<span class="brand-card__badge">PRO</span>
					</div>
					<button type="button" class="pattern-btn brand-card__cta">Upgrade</button>
					<div class="brand-card__divider"></div>
					<div class="brand-card__ai">
						<div class="brand-card__ai-bar" aria-hidden="true"></div>
						<div class="brand-card__ai-rows">
							<div class="brand-card__ai-status">
								<span class="brand-card__ai-dot brand-card__ai-dot--working" aria-hidden="true"></span>
								<span class="brand-card__ai-label">Explaining commit — working…</span>
							</div>
							<div class="brand-card__ai-status">
								<span class="brand-card__ai-dot brand-card__ai-dot--waiting" aria-hidden="true"></span>
								<span class="brand-card__ai-label">Generate changelog — waiting for your input</span>
							</div>
							<div class="brand-card__ai-status">
								<span class="brand-card__ai-dot brand-card__ai-dot--idle" aria-hidden="true"></span>
								<span class="brand-card__ai-label">Review summary — idle</span>
							</div>
						</div>
						<p class="brand-card__ai-summary">
							This change moves gutter rendering off the document change event and onto the visible-ranges
							tracker, eliminating redundant blame lookups.
						</p>
					</div>
				</div>
			</div>
			<p class="pattern__tokens">
				gradient-brand / gradient-brand-subtle · brand · brand-on · border · ai-1/2/3 ·
				agent-working/waiting/idle · fg / fg-muted
			</p>
		</article>
	`;
}

function renderEmptyState(): unknown {
	return html`
		<article class="pattern">
			<h3 class="pattern__title">Empty state</h3>
			<div class="pattern__stage">
				<div class="empty-state">
					<code-icon class="empty-state__icon" icon="search" aria-hidden="true"></code-icon>
					<h4 class="empty-state__heading">No results found</h4>
					<p class="empty-state__body">No commits match your search filters.</p>
					<p class="empty-state__hint">Try widening the date range or removing the author filter.</p>
					<button type="button" class="pattern-btn pattern-btn--primary">Clear Filters</button>
					<a href="#" class="pattern-link pattern-link--sm">Search documentation</a>
				</div>
			</div>
			<p class="pattern__tokens">fg / fg-muted / fg-subtle / fg-faint · accent · accent-fg · link</p>
		</article>
	`;
}

function renderHeatmap(): unknown {
	return html`
		<article class="pattern">
			<h3 class="pattern__title">Activity heatmap</h3>
			<div class="pattern__stage">
				<div class="heatmap">
					<p class="heatmap__caption">Commit density, 12 weeks</p>
					<div class="heatmap__grid">${renderHeatmapCells()}</div>
					<div class="heatmap__legend">
						<span>Less</span>
						<span class="heat-cell heat-cell--05"></span>
						<span class="heat-cell heat-cell--30"></span>
						<span class="heat-cell heat-cell--50"></span>
						<span class="heat-cell heat-cell--70"></span>
						<span class="heat-cell heat-cell--95"></span>
						<span>More</span>
					</div>
				</div>
			</div>
			<p class="pattern__tokens">ramp-05 … ramp-95 · fg-muted / fg-subtle</p>
		</article>
	`;
}

function renderSplitPanes(): unknown {
	return html`
		<article class="pattern">
			<h3 class="pattern__title">Split panes</h3>
			<div class="pattern__stage">
				<div class="split-panes">
					<div class="split-panes__sidebar">
						<div class="split-nav-row">Commits</div>
						<div class="split-nav-row">
							<span>Branches</span>
							<span class="split-nav-row__count">12</span>
						</div>
						<div class="split-nav-row">Remotes</div>
						<div class="split-nav-row split-nav-row--muted">Stashes</div>
					</div>
					<div class="split-sash split-sash--hover"></div>
					<div class="split-panes__content">
						<h4 class="split-panes__heading">Branches</h4>
						<p class="split-panes__line">main · up to date</p>
						<p class="split-panes__line">feature/blame-refactor · ↑3</p>
						<p class="split-panes__line">feature/old-spike · stale</p>
					</div>
				</div>
			</div>
			<p class="pattern__tokens">
				surface / surface-sunken · border-subtle · border-sash-hover · accent · fg-on-emphasis · fg / fg-muted
			</p>
		</article>
	`;
}

function renderSurfaceMap(): unknown {
	return html`
		<article class="pattern">
			<h3 class="pattern__title">Surface hierarchy</h3>
			<div class="pattern__stage">
				<div class="surface-map">
					<div class="surface-map__row">
						<span>The page itself</span>
						<span class="surface-map__name">surface</span>
					</div>
					<div class="surface-map__sunken">
						<span>Recessed wells — filters, terminals, inputs</span>
						<span class="surface-map__name">surface-sunken</span>
					</div>
					<div class="surface-map__raised">
						<div class="surface-map__row">
							<span>Cards float above the page</span>
							<span class="surface-map__name">surface-raised</span>
						</div>
						<div class="surface-map__code">
							<code>git rebase --interactive main~3</code>
							<span class="surface-map__name">surface-code</span>
						</div>
					</div>
					<div class="surface-map__list">
						<div class="surface-map__item surface-map__item--hover">
							<span>Pointer feedback</span>
							<span class="surface-map__name">surface-hover</span>
						</div>
						<div class="surface-map__item surface-map__item--selected">
							<span>Active selection</span>
							<span class="surface-map__name">surface-selected / -fg</span>
						</div>
					</div>
				</div>
			</div>
			<p class="pattern__tokens">
				surface · surface-sunken · surface-raised · surface-code · surface-hover · surface-selected /
				surface-selected-fg (scrim → Dialog over scrim)
			</p>
		</article>
	`;
}

function renderModeDemo(): unknown {
	return html`
		<article class="pattern">
			<h3 class="pattern__title">Highlight &amp; modes</h3>
			<div class="pattern__stage">
				<div class="mode-demo">
					<div class="mode-banner">
						<code-icon icon="edit" aria-hidden="true"></code-icon>
						<span class="mode-banner__label">Editing commit message</span>
						<span class="mode-banner__hint">Esc to cancel</span>
					</div>
					<div class="rebase-rows">
						<div class="rebase-row">
							<span class="rebase-row__verb">pick</span>
							<span class="rebase-row__message">Adds blame gutter cache</span>
						</div>
						<div class="rebase-row rebase-row--current">
							<span class="rebase-row__verb">reword</span>
							<span class="rebase-row__message">Fix flicker on scroll</span>
						</div>
						<div class="rebase-row">
							<span class="rebase-row__verb">pick</span>
							<span class="rebase-row__message">Bump min VS Code to 1.101</span>
						</div>
					</div>
				</div>
			</div>
			<p class="pattern__tokens">highlight (solid marker + 10%/50% tints) · fg / fg-muted</p>
		</article>
	`;
}

function renderStatusBanners(): unknown {
	return html`
		<article class="pattern pattern--wide">
			<h3 class="pattern__title">Status banners</h3>
			<div class="pattern__stage">
				<div class="banner-stack">
					<div class="banner banner--info">
						<code-icon icon="info" aria-hidden="true"></code-icon>
						<span class="banner__title">Repository indexing complete.</span>
						<span class="banner__body">Rich hovers are now available across 3 worktrees.</span>
						<a href="#" class="pattern-link">Learn more</a>
					</div>
					<div class="banner banner--success">
						<code-icon icon="pass" aria-hidden="true"></code-icon>
						<span class="banner__title">Branch published.</span>
						<span class="banner__body">feature/blame-refactor is now tracking origin.</span>
						<a href="#" class="pattern-link">View branch</a>
					</div>
					<div class="banner banner--warning">
						<code-icon icon="warning" aria-hidden="true"></code-icon>
						<span class="banner__title">Rebase paused.</span>
						<span class="banner__body">2 conflicts need resolution before continuing.</span>
						<a href="#" class="pattern-link">Open conflicts</a>
					</div>
					<div class="banner banner--danger">
						<code-icon icon="error" aria-hidden="true"></code-icon>
						<span class="banner__title">Push rejected.</span>
						<span class="banner__body">The remote contains work you don't have locally.</span>
						<a href="#" class="pattern-link">Pull first</a>
					</div>
				</div>
			</div>
			<p class="pattern__tokens">
				info/-bg/-border · success/-bg/-border · warning/-bg/-border · danger/-bg/-border · fg · link
			</p>
		</article>
	`;
}

function renderDialogDemo(): unknown {
	return html`
		<article class="pattern">
			<h3 class="pattern__title">Dialog over scrim</h3>
			<div class="pattern__stage">
				<div class="dialog-demo">
					<div class="dialog-demo__backdrop" aria-hidden="true">
						<div class="dialog-demo__row">Fix gutter blame flicker on scroll</div>
						<div class="dialog-demo__row">Add natural-language commit search</div>
						<div class="dialog-demo__row">Graph: lazy-load avatars</div>
						<div class="dialog-demo__row">Rebase editor keyboard nav</div>
					</div>
					<div class="dialog-demo__scrim"></div>
					<div class="dialog-demo__center">
						<div class="dialog-demo__box">
							<h4 class="dialog-demo__title">Delete branch?</h4>
							<p class="dialog-demo__body">
								feature/old-spike has 2 unmerged commits. This cannot be undone.
							</p>
							<div class="dialog-demo__actions">
								<button type="button" class="pattern-btn pattern-btn--secondary">Cancel</button>
								<button type="button" class="pattern-btn pattern-btn--danger">Delete Branch</button>
							</div>
						</div>
					</div>
				</div>
			</div>
			<p class="pattern__tokens">
				border-subtle · scrim · surface-raised · border · shadow-dialog · danger · on-status · fg / fg-muted
			</p>
		</article>
	`;
}

export function renderPatterns(): unknown {
	return html`
		<div class="patterns">
			<p class="section-note">
				Hand-composed UI built from raw markup + --gl-* tokens only — no shared components, no direct --vscode-*
				reads, no hardcoded color. This is the composition test: switch themes (including both high-contrast
				schemes) to verify the system stays harmonious, legible, and cohesive. Hover/selected states are pinned
				so every state is visible without interaction. Together the cards exercise every semantic --gl-color-*
				token — the *-base primitives are excluded by design (consuming code never reads them).
			</p>
			<div class="patterns__grid">
				${renderCommitCard()} ${renderFileList()} ${renderFormFields()} ${renderWorkList()} ${renderBrandAi()}
				${renderEmptyState()} ${renderHeatmap()} ${renderSplitPanes()} ${renderSurfaceMap()} ${renderModeDemo()}
				${renderStatusBanners()} ${renderDialogDemo()}
			</div>
		</div>
	`;
}
