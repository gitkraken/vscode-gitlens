import type GraphContainer from '@gitkraken/gitkraken-components';
import type { GraphRef, GraphRow, GraphZoneType } from '@gitkraken/gitkraken-components';
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { debounce } from '../../../../../system/function/debounce';
import type {
	GraphAvatars,
	GraphColumnsConfig,
	GraphExcludedRef,
	GraphItemContext,
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
@customElement('web-graph')
export class WebGraph extends LitElement {
	// Use Light DOM instead of Shadow DOM to avoid styling issues
	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	// React root for mounting the React component
	private reactRoot: ReturnType<typeof createRoot> | null = null;

	// State updater function provided by the React component
	private stateUpdater: ((props: Partial<GraphWrapperSubscriberProps>) => void) | null = null;
	private setStateUpdater = (updater: (props: Partial<GraphWrapperSubscriberProps>) => void) => {
		this.stateUpdater = updater;
	};

	// Properties that match GraphWrapperProps
	@property({ type: String })
	activeRow?: string;

	@property({ type: Object })
	avatars?: GraphAvatars;

	@property({ type: Object })
	columns?: any;

	@property({ type: Object })
	context?: GraphItemContext;

	@property({ type: Object })
	config?: any;

	@property({ type: Object })
	downstreams?: any;

	@property({ type: Array })
	rows?: GraphRow[];

	@property({ type: Object })
	excludeRefs?: any;

	@property({ type: Object })
	excludeTypes?: any;

	// @property({ type: String })
	// override nonce?: string;

	@property({ type: Object })
	paging?: any;

	@property({ type: Boolean })
	loading?: boolean;

	@property({ type: Object })
	selectedRows?: GraphWrapperProps['selectedRows'];

	@property({ type: Boolean })
	windowFocused?: boolean;

	@property({ type: Object })
	refsMetadata?: any;

	@property({ type: Object })
	includeOnlyRefs?: any;

	@property({ type: Object })
	rowsStats?: any;

	@property({ type: Boolean })
	rowsStatsLoading?: boolean;

	@property({ type: Object })
	workingTreeStats?: any;

	@property({ type: Object })
	theming?: any;

	@property({ type: Object })
	searchResults?: any;

	@property({ type: Object })
	filter?: any;

	@property({ attribute: false })
	setRef?: (ref: GraphContainer) => void;

	// Clean up React component when disconnected
	override disconnectedCallback(): void {
		if (this.reactRoot) {
			this.reactRoot.unmount();
			this.reactRoot = null;
		}
		super.disconnectedCallback();
	}

	private changedProps: Map<string, unknown> = new Map();
	private updateScheduled: boolean = false;

	override shouldUpdate(changedProperties: Map<string, unknown>): boolean {
		if (!this.stateUpdater) return this.reactRoot == null;

		for (const key of changedProperties.keys() as Iterable<keyof GraphWrapperSubscriberProps>) {
			this.changedProps.set(key, this[key]);
		}

		// Debounce updates to avoid rapid re-renders
		if (this.updateScheduled) return this.reactRoot == null;
		this.updateScheduled = true;

		const { stateUpdater } = this;
		requestAnimationFrame(() => {
			this.updateScheduled = false;
			if (this.changedProps.size > 0) {
				const props = this.getProps(this.changedProps);
				stateUpdater(props);
				this.changedProps.clear();
			}
		});
		return this.reactRoot == null;
	}

	override firstUpdated(): void {
		// Create a React root
		this.reactRoot = createRoot(this.querySelector('.graph__graph-root')!);

		// Get the initial props
		const props = this.getProps();

		// Mount the React component
		this.reactRoot.render(
			createElement(GraphWrapperReact, {
				...props,
				subscriber: this.setStateUpdater,
				onChangeColumns: this.handleChangeColumns,
				onGraphMouseLeave: this.handleGraphMouseLeave,
				onChangeRefsVisibility: this.handleChangeRefsVisibility,
				onChangeSelection: this.handleChangeSelection,
				onDoubleClickRef: this.handleDoubleClickRef,
				onDoubleClickRow: this.handleDoubleClickRow,
				onMissingAvatars: this.handleMissingAvatars,
				onMissingRefsMetadata: this.handleMissingRefsMetadata,
				onMoreRows: this.handleMoreRows,
				onChangeVisibleDays: this.handleChangeVisibleDays,
				onGraphRowHovered: this.handleGraphRowHovered,
				onGraphRowUnhovered: this.handleGraphRowUnhovered,
				onRowContextMenu: this.handleRowContextMenu,
			} as GraphWrapperInitProps),
		);
	}

	override render() {
		return html`<div class="graph__graph-root"></div>`;
	}

	// Collect all props to pass to the React component
	private getProps(_changedProperties?: Map<string, unknown>): Partial<GraphWrapperSubscriberProps> {
		// TODO: look at only sending changed properties
		// if (changedProperties != null) {
		// 	return Object.fromEntries(changedProperties.entries());
		// }

		return {
			activeRow: this.activeRow,
			avatars: this.avatars,
			columns: this.columns,
			context: this.context as GraphWrapperSubscriberProps['context'],
			config: this.config,
			downstreams: this.downstreams,
			rows: this.rows,
			excludeRefs: this.excludeRefs,
			excludeTypes: this.excludeTypes,
			nonce: this.nonce,
			paging: this.paging,
			loading: this.loading,
			selectedRows: this.selectedRows,
			windowFocused: this.windowFocused,
			refsMetadata: this.refsMetadata,
			includeOnlyRefs: this.includeOnlyRefs,
			rowsStats: this.rowsStats,
			rowsStatsLoading: this.rowsStatsLoading,
			workingTreeStats: this.workingTreeStats,
			theming: this.theming,
			searchResults: this.searchResults,
			filter: this.filter,
			setRef: this.setRef,
		};
	}

	// Event handlers that dispatch custom events
	private handleChangeColumns = (settings: GraphColumnsConfig): void => {
		this.dispatchEvent(new CustomEvent('changecolumns', { detail: { settings: settings } }));
	};

	private handleGraphMouseLeave = (): void => {
		this.dispatchEvent(new CustomEvent('graphmouseleave'));
	};

	private handleChangeRefsVisibility = (args: { refs: GraphExcludedRef[]; visible: boolean }): void => {
		this.dispatchEvent(new CustomEvent('changerefsvisibility', { detail: args }));
	};

	private handleChangeSelection = debounce(
		(rows: GraphRow[]): void => void this.dispatchEvent(new CustomEvent('changeselection', { detail: rows })),
		50,
		{ edges: 'both' },
	);

	private handleDoubleClickRef = (args: { ref: GraphRef; metadata?: GraphRefMetadataItem }): void => {
		this.dispatchEvent(new CustomEvent('doubleclickref', { detail: args }));
	};

	private handleDoubleClickRow = (args: { row: GraphRow; preserveFocus?: boolean }): void => {
		this.dispatchEvent(new CustomEvent('doubleclickrow', { detail: args }));
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

	private handleChangeVisibleDays = (args: any): void => {
		this.dispatchEvent(new CustomEvent('changevisibledays', { detail: args }));
	};

	private handleGraphRowHovered = (args: {
		clientX: number;
		currentTarget: HTMLElement;
		graphZoneType: GraphZoneType;
		graphRow: GraphRow;
	}): void => {
		this.dispatchEvent(new CustomEvent('graphrowhovered', { detail: args }));
	};

	private handleGraphRowUnhovered = (args: {
		relatedTarget: EventTarget | null;
		graphZoneType: GraphZoneType;
		graphRow: GraphRow;
	}): void => {
		this.dispatchEvent(new CustomEvent('graphrowunhovered', { detail: args }));
	};

	private handleRowContextMenu = (args: { graphZoneType: GraphZoneType; graphRow: GraphRow }): void => {
		this.dispatchEvent(new CustomEvent('rowcontextmenu', { detail: args }));
	};
}

// Define the element in the custom elements registry
// declare global {
// 	interface HTMLElementTagNameMap {
// 		'gl-graph-wrapper-element': GraphWrapperElement;
// 	}
// }
