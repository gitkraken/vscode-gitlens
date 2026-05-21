import './mergeConflict.scss';
import { html } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import type { IpcCallParamsType, IpcCommand } from '../../ipc/models/ipc.js';
import type { State } from '../../mergeConflict/protocol.js';
import {
	AbortMergeCommand,
	PickHunkCommand,
	PickLineCommand,
	ResetAllCommand,
	ResetHunkCommand,
	SaveAndResolveCommand,
	TakeAllCommand,
	TakeBothAllCommand,
	UpdateOutputCommand,
} from '../../mergeConflict/protocol.js';
import { GlAppHost } from '../shared/appHost.js';
import type { LoggerContext } from '../shared/contexts/logger.js';
import type { HostIpc } from '../shared/ipc.js';
import type { GlMergeConflictPane } from './components/gl-merge-conflict-pane.js';
import { mergeConflictStyles } from './mergeConflict.css.js';
import { MergeConflictStateProvider } from './stateProvider.js';
import './components/gl-merge-conflict-pane.js';
import './components/gl-merge-conflict-output.js';

interface PaneScrollAnchor {
	hunkIndex: number;
	offsetInHunk: number;
	side: 'current' | 'incoming';
}

type PaneDisplayMode = 'full' | 'hunks';

@customElement('gl-merge-conflict-editor')
export class GlMergeConflictEditor extends GlAppHost<State, MergeConflictStateProvider> {
	static override styles = [mergeConflictStyles];

	@state() private _focusedHunkIndex = 0;
	@state() private _displayMode: PaneDisplayMode = 'full';

	@query('gl-merge-conflict-pane[side="current"]')
	private readonly _currentPane!: GlMergeConflictPane;
	@query('gl-merge-conflict-pane[side="incoming"]')
	private readonly _incomingPane!: GlMergeConflictPane;

	override connectedCallback(): void {
		super.connectedCallback?.();
		document.addEventListener('keydown', this.onKeyDown);
	}

	override disconnectedCallback(): void {
		document.removeEventListener('keydown', this.onKeyDown);
		super.disconnectedCallback?.();
	}

	protected override createStateProvider(
		bootstrap: string,
		ipc: HostIpc,
		logger: LoggerContext,
	): MergeConflictStateProvider {
		return new MergeConflictStateProvider(this, bootstrap, ipc, logger);
	}

	override render(): unknown {
		const state = this.state;

		if (state?.unsupported != null) {
			return html`
				<div class="unsupported">
					<div class="unsupported__title">Can't resolve in the GitLens Merge Editor</div>
					<div>${state.unsupported.message}</div>
				</div>
			`;
		}

		const hunks = state?.hunks ?? [];
		const resolutions = state?.resolutions ?? [];
		const resolvedCount = resolutions.filter(r => r.resolved).length;
		const focused = Math.min(this._focusedHunkIndex, Math.max(0, hunks.length - 1));

		return html`
			<div class="layout">
				<div class="toolbar" role="toolbar" aria-label="Merge conflict actions">
					<div class="toolbar__title" title=${state?.filePath ?? ''}>${state?.displayPath ?? '—'}</div>
					<div class="toolbar__count" aria-live="polite">
						${hunks.length === 0
							? html`No conflicts`
							: html`<strong>${focused + 1}</strong> of ${hunks.length} (${resolvedCount} resolved)`}
					</div>
					<button
						class="toolbar__btn"
						type="button"
						title="Previous conflict (Shift+F8)"
						?disabled=${hunks.length < 2}
						@click=${() => this.focusHunk(focused - 1)}
					>
						Prev
					</button>
					<button
						class="toolbar__btn"
						type="button"
						title="Next conflict (F8)"
						?disabled=${hunks.length < 2}
						@click=${() => this.focusHunk(focused + 1)}
					>
						Next
					</button>
					<button
						class="toolbar__btn"
						type="button"
						title=${this._displayMode === 'full'
							? 'Hide context lines — show only conflict hunks'
							: 'Show the full file with conflict regions highlighted'}
						@click=${this.onToggleDisplayMode}
					>
						${this._displayMode === 'full' ? 'View: Full' : 'View: Hunks'}
					</button>
					<div class="toolbar__spacer"></div>
					<button class="toolbar__btn" type="button" @click=${() => this.onTakeAll('current')}>
						Take All Current
					</button>
					<button class="toolbar__btn" type="button" @click=${() => this.onTakeAll('incoming')}>
						Take All Incoming
					</button>
					<button
						class="toolbar__btn"
						type="button"
						title="Take both sides for every conflict, Current first"
						@click=${() => this.onTakeBothAll('current-first')}
					>
						Take Both (C→I)
					</button>
					<button
						class="toolbar__btn"
						type="button"
						title="Take both sides for every conflict, Incoming first"
						@click=${() => this.onTakeBothAll('incoming-first')}
					>
						Take Both (I→C)
					</button>
					<button
						class="toolbar__btn"
						type="button"
						title="Discard every pick and manual edit"
						?disabled=${!(state?.dirty ?? false)}
						@click=${this.onResetAll}
					>
						Reset All
					</button>
					<button class="toolbar__btn" type="button" @click=${this.onAbort}>Abort</button>
					<button
						class="toolbar__btn toolbar__btn--primary"
						type="button"
						?disabled=${resolvedCount === 0}
						@click=${this.onSave}
					>
						Save and Resolve
					</button>
				</div>
				<div class="panes">
					${hunks.length === 0
						? html`<div class="unsupported">No conflicts in this file.</div>`
						: html`
								<gl-merge-conflict-pane
									role="region"
									aria-label="Current changes"
									side="current"
									.hunks=${hunks}
									.resolutions=${resolutions}
									.focusedHunkIndex=${focused}
									.filePath=${state?.filePath ?? ''}
									.stageText=${state?.currentText ?? ''}
									.displayMode=${this._displayMode}
									@pick-line=${this.onPickLine}
									@pick-hunk=${this.onPickHunk}
									@pane-scroll=${this.onPaneScroll}
								></gl-merge-conflict-pane>
								<gl-merge-conflict-pane
									role="region"
									aria-label="Incoming changes"
									side="incoming"
									.hunks=${hunks}
									.resolutions=${resolutions}
									.focusedHunkIndex=${focused}
									.filePath=${state?.filePath ?? ''}
									.stageText=${state?.incomingText ?? ''}
									.displayMode=${this._displayMode}
									@pick-line=${this.onPickLine}
									@pick-hunk=${this.onPickHunk}
									@pane-scroll=${this.onPaneScroll}
								></gl-merge-conflict-pane>
							`}
				</div>
				<gl-merge-conflict-output
					role="region"
					aria-label="Merged output"
					.text=${state?.outputText ?? ''}
					.lineSources=${state?.outputLineSources ?? []}
					.lineMeta=${state?.outputLineMeta ?? []}
					.resolutions=${resolutions}
					.hunks=${hunks}
					.filePath=${state?.filePath ?? ''}
					@output-change=${this.onOutputChange}
					@reset-hunk=${this.onResetHunk}
					@pick-line=${this.onPickLine}
				></gl-merge-conflict-output>
			</div>
		`;
	}

	private focusHunk(index: number): void {
		const hunks = this.state?.hunks ?? [];
		if (hunks.length === 0) return;

		const wrapped = ((index % hunks.length) + hunks.length) % hunks.length;
		this._focusedHunkIndex = wrapped;
	}

	private onPickLine = (e: CustomEvent<{ hunkIndex: number; side: 'current' | 'incoming'; lineIndex: number }>) => {
		this.dispatchCommand(PickLineCommand, e.detail);
	};

	private onPickHunk = (e: CustomEvent<{ hunkIndex: number; side: 'current' | 'incoming' }>) => {
		this.dispatchCommand(PickHunkCommand, e.detail);
		this._focusedHunkIndex = e.detail.hunkIndex;
	};

	private onTakeAll = (side: 'current' | 'incoming') => {
		this.dispatchCommand(TakeAllCommand, { side: side });
	};

	private onTakeBothAll = (order: 'current-first' | 'incoming-first') => {
		this.dispatchCommand(TakeBothAllCommand, { order: order });
	};

	private onToggleDisplayMode = (): void => {
		this._displayMode = this._displayMode === 'full' ? 'hunks' : 'full';
	};

	private onResetAll = () => {
		this.dispatchCommand(ResetAllCommand);
	};

	private onAbort = () => {
		this.dispatchCommand(AbortMergeCommand);
	};

	private onSave = () => {
		this.dispatchCommand(SaveAndResolveCommand);
	};

	private onResetHunk = (e: CustomEvent<{ hunkIndex: number }>) => {
		this.dispatchCommand(ResetHunkCommand, e.detail);
	};

	private onOutputChange = (e: CustomEvent<{ text: string }>) => {
		this.dispatchCommand(UpdateOutputCommand, e.detail);
	};

	private onPaneScroll = (e: CustomEvent<PaneScrollAnchor>) => {
		// Forward to the opposite pane so it scrolls to the same hunk.
		const otherPane = e.detail.side === 'current' ? this._incomingPane : this._currentPane;
		otherPane?.syncScrollToAnchor({ hunkIndex: e.detail.hunkIndex, offsetInHunk: e.detail.offsetInHunk });
	};

	private onKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'F8' && !e.ctrlKey && !e.metaKey && !e.altKey) {
			e.preventDefault();
			this.focusHunk(this._focusedHunkIndex + (e.shiftKey ? -1 : 1));
		}
	};

	private dispatchCommand<T extends IpcCommand<unknown>>(command: T, params?: IpcCallParamsType<T>): void {
		// `IpcCommand` and `IpcCommand<void>` both reach the same runtime path; the optional param
		// covers void-parameter commands cleanly without a second overload.
		this._ipc?.sendCommand(command, params as IpcCallParamsType<T>);
	}
}
