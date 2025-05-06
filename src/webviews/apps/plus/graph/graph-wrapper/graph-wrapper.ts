import type GraphContainer from '@gitkraken/gitkraken-components';
import type { GraphRow, GraphZoneType } from '@gitkraken/gitkraken-components';
import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { html, LitElement } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { GitGraphRowType } from '../../../../../git/models/graph';
import { filterMap } from '../../../../../system/array';
import { getScopedCounter } from '../../../../../system/counter';
import {
	DoubleClickedCommandType,
	GetMissingAvatarsCommand,
	GetMissingRefsMetadataCommand,
	GetMoreRowsCommand,
	UpdateColumnsCommand,
	UpdateRefsVisibilityCommand,
	UpdateSelectionCommand,
} from '../../../../plus/graph/protocol';
import type { CustomEventType } from '../../../shared/components/element';
import { ipcContext } from '../../../shared/contexts/ipc';
import type { TelemetryContext } from '../../../shared/contexts/telemetry';
import { telemetryContext } from '../../../shared/contexts/telemetry';
import { stateContext } from '../context';
import { graphStateContext } from '../stateProvider';
import type { GlGraph } from './graph-wrapper-element';
import './graph-wrapper-element';

declare global {
	// interface HTMLElementTagNameMap {
	// 	'gl-graph-wrapper': GlGraphWrapper;
	// }

	interface GlobalEventHandlersEventMap {
		// passing up event map
		'gl-graph-change-selection': CustomEvent<{ selection: GraphRow[] }>;
		'gl-graph-change-visible-days': CustomEvent<{ top: number; bottom: number }>;
		'gl-graph-mouse-leave': CustomEvent<void>;
		'gl-graph-row-context-menu': CustomEvent<{ graphZoneType: GraphZoneType; graphRow: GraphRow }>;
		'gl-graph-row-hover': CustomEvent<{
			graphZoneType: GraphZoneType;
			graphRow: GraphRow;
			clientX: number;
			currentTarget: HTMLElement;
		}>;
		'gl-graph-row-unhover': CustomEvent<{
			graphZoneType: GraphZoneType;
			graphRow: GraphRow;
			relatedTarget: EventTarget | null;
		}>;
	}
}

@customElement('gl-graph-wrapper')
export class GlGraphWrapper extends SignalWatcher(LitElement) {
	// use Light DOM
	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	@consume({ context: graphStateContext })
	private readonly graphAppState!: typeof graphStateContext.__context__;

	@consume({ context: stateContext, subscribe: true })
	private readonly hostState!: typeof stateContext.__context__;

	@consume({ context: ipcContext })
	private readonly _ipc!: typeof ipcContext.__context__;

	@consume({ context: telemetryContext as any })
	private readonly _telemetry!: TelemetryContext;

	@query('gl-graph')
	graph!: typeof GlGraph;

	private ref?: GraphContainer;
	private onSetRef = (ref: GraphContainer) => {
		this.ref = ref;
	};

	override render() {
		const { graphAppState, hostState } = this;

		return html`<gl-graph
			.setRef=${this.onSetRef}
			.activeRow=${graphAppState.activeRow}
			.avatars=${hostState.avatars}
			.columns=${hostState.columns}
			.config=${hostState.config}
			.context=${hostState.context}
			.downstreams=${hostState.downstreams}
			.excludeRefs=${hostState.excludeRefs}
			.excludeTypes=${hostState.excludeTypes}
			.filter=${graphAppState.filter}
			.includeOnlyRefs=${hostState.includeOnlyRefs}
			?loading=${graphAppState.loading}
			nonce=${ifDefined(hostState.nonce)}
			.paging=${hostState.paging}
			.refsMetadata=${hostState.refsMetadata}
			.rows=${hostState.rows}
			.rowsStats=${hostState.rowsStats}
			.searchResults=${graphAppState.searchResults}
			.selectedRows=${graphAppState.selectedRows}
			.theming=${graphAppState.theming}
			?windowFocused=${hostState.windowFocused}
			.workingTreeStats=${hostState.workingTreeStats}
			@changecolumns=${this.onColumnsChanged}
			@changerefsvisibility=${this.onRefsVisibilityChanged}
			@changeselection=${this.onSelectionChanged}
			@changevisibledays=${this.onVisibleDaysChanged}
			@missingavatars=${this.onMissingAvatars}
			@missingrefsmetadata=${this.onMissingRefsMetadata}
			@morerows=${this.onGetMoreRows}
			@graphmouseleave=${this.onMouseLeave}
			@refdoubleclick=${this.onRefDoubleClick}
			@rowcontextmenu=${this.onRowContextMenu}
			@rowdoubleclick=${this.onRowDoubleClick}
			@rowhover=${this.onRowHover}
			@rowunhover=${this.onRowUnhover}
		></gl-graph>`;
	}

	selectCommits(shaList: string[], includeToPrevSel: boolean, isAutoOrKeyScroll: boolean) {
		this.ref?.selectCommits(shaList, includeToPrevSel, isAutoOrKeyScroll);
	}

	private onColumnsChanged(event: CustomEventType<'graph-changecolumns'>) {
		this._ipc.sendCommand(UpdateColumnsCommand, { config: event.detail.settings });
	}

	private onGetMoreRows({ detail: sha }: CustomEventType<'graph-morerows'>) {
		this.graphAppState.loading = true;
		this._ipc.sendCommand(GetMoreRowsCommand, { id: sha });
	}

	private onMouseLeave() {
		this.dispatchEvent(new CustomEvent('gl-graph-mouse-leave'));
	}

	private onMissingAvatars({ detail: emails }: CustomEventType<'graph-missingavatars'>) {
		this._ipc.sendCommand(GetMissingAvatarsCommand, { emails: emails });
	}

	private onMissingRefsMetadata({ detail: metadata }: CustomEventType<'graph-missingrefsmetadata'>) {
		this._ipc.sendCommand(GetMissingRefsMetadataCommand, { metadata: metadata });
	}

	private onRefDoubleClick({ detail: { ref, metadata } }: CustomEventType<'graph-doubleclickref'>) {
		this._ipc.sendCommand(DoubleClickedCommandType, { type: 'ref', ref: ref, metadata: metadata });
	}

	private onRefsVisibilityChanged({ detail }: CustomEventType<'graph-changerefsvisibility'>) {
		this._ipc.sendCommand(UpdateRefsVisibilityCommand, detail);
	}

	private onRowContextMenu({ detail: { graphRow, graphZoneType } }: CustomEventType<'graph-rowcontextmenu'>) {
		this.dispatchEvent(
			new CustomEvent('gl-graph-row-context-menu', {
				detail: { graphZoneType: graphZoneType, graphRow: graphRow },
			}),
		);
	}

	private onRowDoubleClick({ detail: { row, preserveFocus } }: CustomEventType<'graph-doubleclickrow'>) {
		this._ipc.sendCommand(DoubleClickedCommandType, {
			type: 'row',
			row: { id: row.sha, type: row.type as GitGraphRowType },
			preserveFocus: preserveFocus,
		});
	}

	private onRowHover({ detail }: CustomEventType<'graph-graphrowhovered'>) {
		this.dispatchEvent(new CustomEvent('gl-graph-row-hover', { detail: detail }));
	}

	private onRowUnhover({ detail }: CustomEventType<'graph-graphrowunhovered'>) {
		this.dispatchEvent(new CustomEvent('gl-graph-row-unhover', { detail: detail }));
	}

	private _selectionCounter = getScopedCounter();

	private onSelectionChanged({ detail: rows }: CustomEventType<'graph-changeselection'>) {
		const selection = filterMap(rows, r =>
			r != null ? { id: r.sha, type: r.type as GitGraphRowType } : undefined,
		);

		const active = rows[rows.length - 1];
		const activeKey = active != null ? `${active.sha}|${active.date}` : undefined;
		this.graphAppState.activeRow = activeKey;
		this.graphAppState.activeDay = active?.date;

		this.dispatchEvent(new CustomEvent('gl-graph-change-selection', { detail: { selection: selection } }));
		this._ipc.sendCommand(UpdateSelectionCommand, { selection: selection });

		const count = this._selectionCounter.next();
		if (count === 1 || count % 100 === 0) {
			queueMicrotask(() =>
				this._telemetry.sendEvent({
					name: 'graph/row/selected',
					data: { rows: selection.length, count: count },
				}),
			);
		}
	}

	private onVisibleDaysChanged({ detail }: CustomEventType<'graph-changevisibledays'>) {
		this.dispatchEvent(new CustomEvent('gl-graph-change-visible-days', { detail: detail }));
	}
}
