import type GraphContainer from '@gitkraken/gitkraken-components';
import type { GraphRef, GraphRow, GraphZoneType } from '@gitkraken/gitkraken-components';
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { SearchQuery } from '../../../../../constants.search';
import { debounce } from '../../../../../system/function/debounce';
import type {
	GraphColumnsConfig,
	GraphExcludedRef,
	GraphMissingRefsMetadata,
	GraphRefMetadataItem,
} from '../../../../plus/graph/protocol';
import type { GraphWrapperInitProps, GraphWrapperProps, GraphWrapperSubscriberProps } from './graph-wrapper.react';
import { GraphWrapperReact } from './graph-wrapper.react';

/**
 * A LitElement web component that encapsulates the GraphWrapperReact component.
 * This component mounts the React component once and then updates its state
 * without remounting on subsequent property changes.
 */
@customElement('gl-graph')
export class GlGraph extends LitElement {
	// Use Light DOM instead of Shadow DOM to avoid styling issues
	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	// React root for mounting the React component
	private reactRoot: ReturnType<typeof createRoot> | null = null;

	// State updater function provided by the React component
	private provideReactState: ((props: Partial<GraphWrapperSubscriberProps>) => void) | null = null;
	private setReactStateProvider = (updater: (props: Partial<GraphWrapperSubscriberProps>) => void) => {
		this.provideReactState = updater;
	};

	// Properties that match GraphWrapperProps
	@property({ type: String })
	activeRow?: GraphWrapperProps['activeRow'];

	@property({ type: Object })
	avatars?: GraphWrapperProps['avatars'];

	@property({ type: Object })
	columns?: GraphWrapperProps['columns'];

	@property({ type: Object })
	context?: GraphWrapperProps['context'];

	@property({ type: Object })
	config?: GraphWrapperProps['config'];

	@property({ type: Object })
	downstreams?: GraphWrapperProps['downstreams'];

	@property({ type: Array })
	rows?: GraphWrapperProps['rows'];

	@property({ type: Object })
	excludeRefs?: GraphWrapperProps['excludeRefs'];

	@property({ type: Object })
	excludeTypes?: GraphWrapperProps['excludeTypes'];

	// @property({ type: String })
	// override nonce?: string;

	@property({ type: Object })
	paging?: GraphWrapperProps['paging'];

	@property({ type: Boolean })
	loading?: GraphWrapperProps['loading'];

	@property({ type: Object })
	selectedRows?: GraphWrapperProps['selectedRows'];

	@property({ type: Boolean })
	windowFocused?: GraphWrapperProps['windowFocused'];

	@property({ type: Object })
	refsMetadata?: GraphWrapperProps['refsMetadata'];

	@property({ type: Object })
	includeOnlyRefs?: GraphWrapperProps['includeOnlyRefs'];

	@property({ type: Object })
	rowsStats?: GraphWrapperProps['rowsStats'];

	@property({ type: Boolean })
	rowsStatsLoading?: GraphWrapperProps['rowsStatsLoading'];

	@property({ type: Object })
	workingTreeStats?: GraphWrapperProps['workingTreeStats'];

	@property({ type: Object })
	theming?: GraphWrapperProps['theming'];

	@property({ type: Object })
	searchResults?: GraphWrapperProps['searchResults'];

	@property({ type: Object })
	filter!: SearchQuery;

	@property({ attribute: false })
	setRef!: (ref: GraphContainer) => void;

	// Clean up React component when disconnected
	override disconnectedCallback(): void {
		if (this.reactRoot) {
			this.reactRoot.unmount();
			this.reactRoot = null;
		}
		super.disconnectedCallback?.();
	}

	private changedProps: Map<string, unknown> = new Map();
	private updateScheduled: boolean = false;

	override shouldUpdate(changedProperties: Map<string, unknown>): boolean {
		if (!this.provideReactState) return this.reactRoot == null;

		for (const key of changedProperties.keys() as Iterable<keyof GraphWrapperSubscriberProps>) {
			this.changedProps.set(key, this[key]);
		}

		// Debounce updates to avoid rapid re-renders
		if (this.updateScheduled) return this.reactRoot == null;
		this.updateScheduled = true;

		const { provideReactState: stateUpdater } = this;
		requestAnimationFrame(() => {
			this.updateScheduled = false;
			if (this.changedProps.size > 0) {
				stateUpdater(Object.fromEntries(this.changedProps));
				this.changedProps.clear();
			}
		});
		return this.reactRoot == null;
	}

	override firstUpdated(): void {
		// Create a React root
		this.reactRoot = createRoot(this.querySelector('.graph__graph-root')!);

		// Mount the React component
		this.reactRoot.render(
			createElement(GraphWrapperReact, {
				setRef: this.setRef,
				subscriber: this.setReactStateProvider,

				activeRow: this.activeRow,
				avatars: this.avatars,
				columns: this.columns,
				config: this.config,
				context: this.context,
				downstreams: this.downstreams,
				excludeRefs: this.excludeRefs,
				excludeTypes: this.excludeTypes,
				filter: this.filter,
				includeOnlyRefs: this.includeOnlyRefs,
				loading: this.loading,
				nonce: this.nonce,
				paging: this.paging,
				refsMetadata: this.refsMetadata,
				rows: this.rows,
				rowsStats: this.rowsStats,
				rowsStatsLoading: this.rowsStatsLoading,
				searchResults: this.searchResults,
				selectedRows: this.selectedRows,
				theming: this.theming,
				windowFocused: this.windowFocused,
				workingTreeStats: this.workingTreeStats,

				onChangeColumns: this.handleChangeColumns,
				onChangeRefsVisibility: this.handleChangeRefsVisibility,
				onChangeSelection: this.handleChangeSelection,
				onChangeVisibleDays: this.handleChangeVisibleDays,
				onMissingAvatars: this.handleMissingAvatars,
				onMissingRefsMetadata: this.handleMissingRefsMetadata,
				onMoreRows: this.handleMoreRows,
				onMouseLeave: this.handleMouseLeave,
				onRefDoubleClick: this.handleRefDoubleClick,
				onRowContextMenu: this.handleRowContextMenu,
				onRowDoubleClick: this.handleRowDoubleClick,
				onRowHover: this.handleRowHover,
				onRowUnhover: this.handleRowUnhover,
			} satisfies GraphWrapperInitProps),
		);
	}

	override render() {
		return html`<div class="graph__graph-root"></div>`;
	}

	// Event handlers that dispatch custom events
	private handleChangeColumns = debounce((columns: GraphColumnsConfig): void => {
		this.dispatchEvent(new CustomEvent('changecolumns', { detail: { settings: columns } }));
	}, 250);

	private handleChangeRefsVisibility = (detail: { refs: GraphExcludedRef[]; visible: boolean }): void => {
		this.dispatchEvent(new CustomEvent('changerefsvisibility', { detail: detail }));
	};

	private handleChangeSelection = debounce(
		(rows: GraphRow[]): void => void this.dispatchEvent(new CustomEvent('changeselection', { detail: rows })),
		250,
		{ edges: 'both' },
	);

	private handleChangeVisibleDays = (detail: { top: number; bottom: number }): void => {
		this.dispatchEvent(new CustomEvent('changevisibledays', { detail: detail }));
	};

	private handleMissingAvatars = (emails: Record<string, string>): void => {
		this.dispatchEvent(new CustomEvent('missingavatars', { detail: emails }));
	};

	private handleMissingRefsMetadata = (metadata: GraphMissingRefsMetadata): void => {
		this.dispatchEvent(new CustomEvent('missingrefsmetadata', { detail: metadata }));
	};

	private handleMoreRows = (id?: string): void => {
		this.dispatchEvent(new CustomEvent('morerows', { detail: id }));
	};

	private handleMouseLeave = (): void => {
		this.dispatchEvent(new CustomEvent('graphmouseleave'));
	};

	private handleRefDoubleClick = (detail: { ref: GraphRef; metadata?: GraphRefMetadataItem }): void => {
		this.dispatchEvent(new CustomEvent('refdoubleclick', { detail: detail }));
	};

	private handleRowContextMenu = (detail: { graphZoneType: GraphZoneType; graphRow: GraphRow }): void => {
		this.dispatchEvent(new CustomEvent('rowcontextmenu', { detail: detail }));
	};

	private handleRowDoubleClick = (detail: { row: GraphRow; preserveFocus?: boolean }): void => {
		this.dispatchEvent(new CustomEvent('rowdoubleclick', { detail: detail }));
	};

	private handleRowHover = debounce(
		(detail: {
			graphZoneType: GraphZoneType;
			graphRow: GraphRow;
			clientX: number;
			currentTarget: HTMLElement;
		}): void => {
			this.dispatchEvent(new CustomEvent('rowhover', { detail: detail }));
		},
		250,
	);

	private handleRowUnhover = (detail: {
		graphZoneType: GraphZoneType;
		graphRow: GraphRow;
		relatedTarget: EventTarget | null;
	}): void => {
		this.handleRowHover.cancel();
		this.dispatchEvent(new CustomEvent('rowunhover', { detail: detail }));
	};
}

// Define the element in the custom elements registry
// declare global {
// 	interface HTMLElementTagNameMap {
// 		'gl-graph-wrapper-element': GraphWrapperElement;
// 	}
// }
