import type GraphContainer from '@gitkraken/gitkraken-components';
import type { GraphRow, GraphZoneType } from '@gitkraken/gitkraken-components';
import { refZone } from '@gitkraken/gitkraken-components';
import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { html, LitElement } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { GitGraphRowType } from '../../../../../git/models/graph';
import { debounce } from '../../../../../system/decorators/debounce';
import {
	DoubleClickedCommandType,
	GetMissingAvatarsCommand,
	GetMissingRefsMetadataCommand,
	GetMoreRowsCommand,
	GetRowHoverRequest,
	UpdateColumnsCommand,
	UpdateGraphConfigurationCommand,
	UpdateRefsVisibilityCommand,
	UpdateSelectionCommand,
} from '../../../../plus/graph/protocol';
import type { CustomEventType } from '../../../shared/components/element';
import { ipcContext } from '../../../shared/contexts/ipc';
import type { TelemetryContext } from '../../../shared/contexts/telemetry';
import { telemetryContext } from '../../../shared/contexts/telemetry';
import { stateContext } from '../context';
import type { GlGraphHover } from '../hover/graphHover';
import { graphStateContext } from '../stateProvider';
import type { WebGraph } from './graph-wrapper-element';
import '../hover/graphHover';
import './graph-wrapper-element';

declare global {
	// interface HTMLElementTagNameMap {
	// 	'gl-graph-wrapper': GlGraphWrapper;
	// }

	interface GlobalEventHandlersEventMap {
		// passing up event map
		'gl-graph-mouse-leave': CustomEvent<void>;
		'gl-graph-change-visible-days': CustomEvent<{ top: number; bottom: number }>;
		'gl-graph-hovered-row': CustomEvent<{ graphZoneType: GraphZoneType; graphRow: GraphRow }>;
	}
}

@customElement('gl-graph-wrapper')
export class GlGraphWrapper extends SignalWatcher(LitElement) {
	// use Light DOM
	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	@consume({ context: stateContext, subscribe: true })
	private readonly hostState!: typeof stateContext.__context__;

	@consume({ context: ipcContext })
	private readonly _ipc!: typeof ipcContext.__context__;

	@consume({ context: telemetryContext as any })
	private readonly _telemetry!: TelemetryContext;

	private onGetMissingAvatars({ detail: emails }: CustomEventType<'graph-missingavatars'>) {
		this._ipc.sendCommand(GetMissingAvatarsCommand, { emails: emails });
	}

	private onGetMissingRefsMetadata({ detail: metadata }: CustomEventType<'graph-missingrefsmetadata'>) {
		this._ipc.sendCommand(GetMissingRefsMetadataCommand, { metadata: metadata });
	}

	private onGetMoreRows({ detail: sha }: CustomEventType<'graph-morerows'>) {
		this.graphAppState.loading = true;
		this._ipc.sendCommand(GetMoreRowsCommand, { id: sha });
	}

	@debounce(250)
	private onColumnsChanged(event: CustomEventType<'graph-changecolumns'>) {
		this._ipc.sendCommand(UpdateColumnsCommand, {
			config: event.detail.settings,
		});
	}

	private onRefsVisibilityChanged({ detail }: CustomEventType<'graph-changerefsvisibility'>) {
		this._ipc.sendCommand(UpdateRefsVisibilityCommand, detail);
	}

	private onDoubleClickRef({ detail: { ref, metadata } }: CustomEventType<'graph-doubleclickref'>) {
		this._ipc.sendCommand(DoubleClickedCommandType, {
			type: 'ref',
			ref: ref,
			metadata: metadata,
		});
	}

	private onDoubleClickRow({ detail: { row, preserveFocus } }: CustomEventType<'graph-doubleclickrow'>) {
		this._ipc.sendCommand(DoubleClickedCommandType, {
			type: 'row',
			row: { id: row.sha, type: row.type as GitGraphRowType },
			preserveFocus: preserveFocus,
		});
	}

	private onGraphConfigurationChanged({ detail: changes }: CustomEventType<'graph-changegraphconfiguration'>) {
		this._ipc.sendCommand(UpdateGraphConfigurationCommand, { changes: changes });
	}

	@debounce(250)
	private onSelectionChanged({ detail: rows }: CustomEventType<'graph-changeselection'>) {
		const selection = rows.filter(r => r != null).map(r => ({ id: r.sha, type: r.type as GitGraphRowType }));
		this._telemetry.sendEvent({ name: 'graph/row/selected', data: { rows: selection.length } });

		this.graphHover.hide();

		const active = rows[rows.length - 1];
		const activeKey = active != null ? `${active.sha}|${active.date}` : undefined;
		this.graphAppState.activeRow = activeKey;
		this.graphAppState.activeDay = active?.date;

		this._ipc.sendCommand(UpdateSelectionCommand, {
			selection: selection,
		});
	}

	private async onHoverRowPromise(row: GraphRow) {
		try {
			const request = await this._ipc.sendRequest(GetRowHoverRequest, {
				type: row.type as GitGraphRowType,
				id: row.sha,
			});
			this._telemetry.sendEvent({ name: 'graph/row/hovered', data: {} });
			return request;
		} catch (ex) {
			return { id: row.sha, markdown: { status: 'rejected' as const, reason: ex } };
		}
	}

	private handleOnGraphRowHovered({
		detail: { graphRow, graphZoneType, clientX, currentTarget },
	}: CustomEventType<'graph-graphrowhovered'>) {
		if (graphZoneType === refZone) return;
		this.dispatchEvent(
			new CustomEvent('gl-graph-hovered-row', { detail: { graphZoneType: graphZoneType, graphRow: graphRow } }),
		);
		const hoverComponent = this.graphHover;
		if (hoverComponent == null) return;
		const rect = currentTarget.getBoundingClientRect();
		const x = clientX;
		const y = rect.top;
		const height = rect.height;
		const width = 60; // Add some width, so `skidding` will be able to apply
		const anchor = {
			getBoundingClientRect: function () {
				return {
					width: width,
					height: height,
					x: x,
					y: y,
					top: y,
					left: x,
					right: x + width,
					bottom: y + height,
				};
			},
		};
		hoverComponent.requestMarkdown ??= this.onHoverRowPromise.bind(this);
		hoverComponent.onRowHovered(graphRow, anchor);
	}

	private handleOnGraphRowUnhovered({
		detail: { graphRow, graphZoneType, relatedTarget },
	}: CustomEventType<'graph-graphrowunhovered'>) {
		if (graphZoneType === refZone) return;
		this.graphHover.onRowUnhovered(graphRow, relatedTarget);
	}

	@query('web-graph')
	webGraph!: typeof WebGraph;

	selectCommits(shaList: string[], includeToPrevSel: boolean, isAutoOrKeyScroll: boolean) {
		this.ref?.selectCommits(shaList, includeToPrevSel, isAutoOrKeyScroll);
	}

	private onChangeVisibleDays({ detail }: CustomEventType<'graph-changevisibledays'>) {
		this.dispatchEvent(new CustomEvent('gl-graph-change-visible-days', { detail: detail }));
	}

	@consume({ context: graphStateContext })
	private readonly graphAppState!: typeof graphStateContext.__context__;

	private ref?: GraphContainer;

	@query('gl-graph-hover#commit-hover')
	private readonly graphHover!: GlGraphHover;

	resetHover() {
		this.graphHover.reset();
	}

	private handleRowContextMenu() {
		this.graphHover.hide();
	}

	override render() {
		return html`<gl-graph-hover id="commit-hover" distance=${0} skidding=${15}></gl-graph-hover
			><web-graph
				nonce=${ifDefined(this.hostState.nonce)}
				activeRow=${ifDefined(this.graphAppState.activeRow)}
				.avatars=${this.hostState.avatars ?? {}}
				.columns=${this.hostState.columns ?? {}}
				.context=${this.hostState.context ?? {}}
				.theming=${this.graphAppState.theming ?? {}}
				.config=${this.hostState.config ?? {}}
				.downstreams=${this.hostState.downstreams ?? {}}
				.excludeRefs=${this.hostState.excludeRefs ?? {}}
				.excludeTypes=${this.hostState.excludeTypes ?? {}}
				.rows=${this.hostState.rows ?? []}
				.includeOnlyRefs=${this.hostState.includeOnlyRefs ?? {}}
				?windowFocused=${this.hostState.windowFocused}
				?loading=${this.graphAppState.loading}
				.selectedRows=${this.graphAppState.selectedRows ?? {}}
				.searchResults=${this.graphAppState.searchResults ?? {}}
				.refsMetadata=${this.hostState.refsMetadata ?? {}}
				.rowsStats=${this.hostState.rowsStats ?? {}}
				.workingTreeStats=${this.hostState.workingTreeStats ?? {}}
				.paging=${this.hostState.paging ?? {}}
				.setRef=${(ref: GraphContainer) => {
					// eslint-disable-next-line lit/no-this-assign-in-render
					this.ref = ref;
				}}
				.filter=${this.graphAppState.filter}
				@changecolumns=${this.onColumnsChanged}
				@changegraphconfiguration=${this.onGraphConfigurationChanged}
				@changerefsvisibility=${this.onRefsVisibilityChanged}
				@changeselection=${this.onSelectionChanged}
				@doubleclickref=${this.onDoubleClickRef}
				@doubleclickrow=${this.onDoubleClickRow}
				@missingavatars=${this.onGetMissingAvatars}
				@missingrefsmetadata=${this.onGetMissingRefsMetadata}
				@morerows=${this.onGetMoreRows}
				@changevisibledays=${this.onChangeVisibleDays}
				@graphrowhovered=${this.handleOnGraphRowHovered}
				@graphrowunhovered=${this.handleOnGraphRowUnhovered}
				@rowcontextmenu=${this.handleRowContextMenu}
				@graphmouseleave=${(e: CustomEvent) =>
					this.dispatchEvent(new CustomEvent('gl-graph-mouse-leave', { detail: e.detail }))}
			></web-graph>`;
	}
}
