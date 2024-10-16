import type { GraphRef, GraphRefOptData, GraphRow } from '@gitkraken/gitkraken-components';
import GraphContainer from '@gitkraken/gitkraken-components';
import { consume } from '@lit/context';
import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import React from 'react';
import { render, unmountComponentAtNode } from 'react-dom';
import type { GraphBranchesVisibility } from '../../../../config';
import type { SearchQuery } from '../../../../constants.search';
import type {
	DidEnsureRowParams,
	DidGetRowHoverParams,
	DidSearchParams,
	GraphColumnsConfig,
	GraphExcludedRef,
	GraphExcludeTypes,
	GraphMissingRefsMetadata,
	GraphRefMetadataItem,
	State,
	UpdateGraphConfigurationParams,
	UpdateStateCallback,
} from '../../../../plus/webviews/graph/protocol';
import type { Disposable } from '../../shared/events';
import { stateContext } from './stateProvider';

@customElement('gl-graph-container')
export class GlGraphContainer extends LitElement {
	private disposables: Disposable[] = [];
	private reactRootEl: HTMLDivElement | undefined;
	private reactElement: React.ReactElement | undefined;

	@consume({ context: stateContext, subscribe: true })
	@state()
	state!: State;

	override connectedCallback(): void {
		super.connectedCallback();
		this.reactRootEl = document.createElement('div');
		this.shadowRoot?.appendChild(this.reactRootEl);
		this.reactElement = React.createElement(GraphContainer2, {
			state: this.state,
		});

		render(this.reactElement, this.reactRootEl);
	}

	override updated(changedProperties: Map<string | number | symbol, unknown>): void {
		super.updated(changedProperties);

		if (this.reactElement) {
			console.log(this.reactElement);
			this.reactElement.props.state = { ...this.state };
		}
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();

		if (this.reactRootEl) {
			unmountComponentAtNode(this.reactRootEl);
		}
	}

	override render() {
		return html``;
	}
}

interface GraphContainer2Props {
	state: State;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
function GraphContainer2({ state }: GraphContainer2Props) {
	return (
		<>
			{Object.entries(state).map(([key, value]) => (
				<div key={key}>
					<span>{key}</span>
					<span>{JSON.stringify(value)}</span>
				</div>
			))}
		</>
	);
}
