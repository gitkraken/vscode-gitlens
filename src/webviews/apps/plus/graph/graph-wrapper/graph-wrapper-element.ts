import type GraphContainer from '@gitkraken/gitkraken-components';
import type { GraphRef, GraphRow, GraphZoneType } from '@gitkraken/gitkraken-components';
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
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

// @customElement('gl-graph-wrapper-element')
// export class GraphWrapperElement extends LitElement {

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
	@state()
	private reactRoot: ReturnType<typeof createRoot> | null = null;

	// Reference to the GraphContainer instance
	@state()
	private graphRef: GraphContainer | null = null;

	// State updater function provided by the React component
	// @state()
	private stateUpdater: ((props: Partial<GraphWrapperSubscriberProps>) => void) | null = null;

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

	// Mount the React component on first connection to DOM
	override connectedCallback(): void {
		super.connectedCallback();
		this.mountReactComponent();
	}

	// Clean up React component when disconnected
	override disconnectedCallback(): void {
		if (this.reactRoot) {
			this.reactRoot.unmount();
			this.reactRoot = null;
		}
		super.disconnectedCallback();
	}

	// Update the React component's state when properties change
	override updated(changedProperties: Map<string, unknown>): void {
		if (this.stateUpdater) {
			// Only update if we have a state updater and properties have changed
			const props = this.getProps(changedProperties);
			this.stateUpdater(props);
		}
	}

	// Mount the React component once
	private mountReactComponent(): void {
		// Create a container for the React component
		const container = document.createElement('div');
		container.classList.add('graph__graph-root');
		this.appendChild(container);

		// Create a React root
		this.reactRoot = createRoot(container);

		// Get the initial props
		const props = this.getProps();

		// Mount the React component
		this.reactRoot.render(
			createElement(GraphWrapperReact, {
				...props,
				subscriber: (updater: (props: Partial<GraphWrapperSubscriberProps>) => void) => {
					this.stateUpdater = updater;
				},
				onChangeColumns: this.handleChangeColumns.bind(this),
				onGraphMouseLeave: this.handleGraphMouseLeave.bind(this),
				onChangeRefsVisibility: this.handleChangeRefsVisibility.bind(this),
				onChangeSelection: this.handleChangeSelection.bind(this),
				onDoubleClickRef: this.handleDoubleClickRef.bind(this),
				onDoubleClickRow: this.handleDoubleClickRow.bind(this),
				onMissingAvatars: this.handleMissingAvatars.bind(this),
				onMissingRefsMetadata: this.handleMissingRefsMetadata.bind(this),
				onMoreRows: this.handleMoreRows.bind(this),
				onChangeVisibleDays: this.handleChangeVisibleDays.bind(this),
				onGraphRowHovered: this.handleGraphRowHovered.bind(this),
				onGraphRowUnhovered: this.handleGraphRowUnhovered.bind(this),
				onRowContextMenu: this.handleRowContextMenu.bind(this),
			} as GraphWrapperInitProps),
		);
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

	// Public method to access the GraphContainer reference
	public getGraphRef(): GraphContainer | null {
		return this.graphRef;
	}

	// Function property for setRef
	@property({ attribute: false })
	setRef?: (ref: GraphContainer) => void;

	// Event handlers that dispatch custom events
	private handleChangeColumns(settings: GraphColumnsConfig): void {
		this.dispatchEvent(new CustomEvent('changecolumns', { detail: { settings: settings } }));
	}

	private handleGraphMouseLeave(): void {
		this.dispatchEvent(new CustomEvent('graphmouseleave'));
	}

	private handleChangeRefsVisibility(args: { refs: GraphExcludedRef[]; visible: boolean }): void {
		this.dispatchEvent(new CustomEvent('changerefsvisibility', { detail: args }));
	}

	private handleChangeSelection(rows: GraphRow[]): void {
		this.dispatchEvent(new CustomEvent('changeselection', { detail: rows }));
	}

	private handleDoubleClickRef(args: { ref: GraphRef; metadata?: GraphRefMetadataItem }): void {
		this.dispatchEvent(new CustomEvent('doubleclickref', { detail: args }));
	}

	private handleDoubleClickRow(args: { row: GraphRow; preserveFocus?: boolean }): void {
		this.dispatchEvent(new CustomEvent('doubleclickrow', { detail: args }));
	}

	private handleMissingAvatars(emails: Record<string, string>): void {
		this.dispatchEvent(new CustomEvent('missingavatars', { detail: emails }));
	}

	private handleMissingRefsMetadata(metadata: GraphMissingRefsMetadata): void {
		this.dispatchEvent(new CustomEvent('missingrefsmetadata', { detail: metadata }));
	}

	private handleMoreRows(id?: string): void {
		this.dispatchEvent(new CustomEvent('morerows', { detail: id }));
	}

	private handleChangeVisibleDays(args: any): void {
		this.dispatchEvent(new CustomEvent('changevisibledays', { detail: args }));
	}

	private handleGraphRowHovered(args: {
		clientX: number;
		currentTarget: HTMLElement;
		graphZoneType: GraphZoneType;
		graphRow: GraphRow;
	}): void {
		this.dispatchEvent(new CustomEvent('graphrowhovered', { detail: args }));
	}

	private handleGraphRowUnhovered(args: {
		relatedTarget: EventTarget | null;
		graphZoneType: GraphZoneType;
		graphRow: GraphRow;
	}): void {
		this.dispatchEvent(new CustomEvent('graphrowunhovered', { detail: args }));
	}

	private handleRowContextMenu(args: { graphZoneType: GraphZoneType; graphRow: GraphRow }): void {
		this.dispatchEvent(new CustomEvent('rowcontextmenu', { detail: args }));
	}

	// Render method - the actual rendering is handled by React
	override render() {
		return html``;
	}
}

// Define the element in the custom elements registry
// declare global {
// 	interface HTMLElementTagNameMap {
// 		'gl-graph-wrapper-element': GraphWrapperElement;
// 	}
// }
