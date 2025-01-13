import { getPlatform } from '@env/platform';
import type { GraphPlatform, GraphRef, GraphRefOptData, GraphRow } from '@gitkraken/gitkraken-components';
import GraphContainer from '@gitkraken/gitkraken-components';
import { consume } from '@lit/context';
import { emit, subscribe, unsubscribe } from '@nextcloud/event-bus';
import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { ReactElement } from 'react';
import React, { createElement, useEffect, useState } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
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
import { GlMarkdown } from '../../shared/components/markdown/markdown.react';
import type { Disposable } from '../../shared/events';
import styles from './graph.old.lit.scss';
import { stateContext } from './stateProvider';
// import './graph.old.scss';

console.log({ styles: styles });

const getClientPlatform = (): GraphPlatform => {
	switch (getPlatform()) {
		case 'web-macOS':
			return 'darwin';
		case 'web-windows':
			return 'win32';
		case 'web-linux':
		default:
			return 'linux';
	}
};

@customElement('gl-graph-container')
export class GlGraphContainer extends LitElement {
	private disposables: Disposable[] = [];
	private root?: Root;
	private reactRootEl: HTMLDivElement | undefined;
	private reactElement: React.ReactElement | undefined;

	static override get styles() {
		return [styles];
	}

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
		this.root = createRoot(this.reactRootEl);
		this.root.render(this.reactElement);
	}

	override updated(changedProperties: Map<string | number | symbol, unknown>): void {
		super.updated(changedProperties);
		if (this.reactElement) {
			console.log(this.reactElement);
			emit('udpateState', { state: this.state });
		}
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();

		if (this.reactRootEl) {
			this.root?.unmount();
		}
	}

	override render() {
		return html``;
	}
}

interface GraphContainer2Props {
	state: State;
}

const clientPlatform = getClientPlatform();

// eslint-disable-next-line @typescript-eslint/naming-convention
function GraphContainer2({ state: _state }: GraphContainer2Props) {
	const [state, setState] = useState(_state);
	useEvent('udpateState', ({ state }) => {
		setState({ ...state });
	});
	const createIconElements = (): Record<string, ReactElement> => {
		const iconList = [
			'head',
			'remote',
			'remote-github',
			'remote-githubEnterprise',
			'remote-gitlab',
			'remote-gitlabSelfHosted',
			'remote-bitbucket',
			'remote-bitbucketServer',
			'remote-azureDevops',
			'tag',
			'stash',
			'check',
			'loading',
			'warning',
			'added',
			'modified',
			'deleted',
			'renamed',
			'resolved',
			'pull-request',
			'show',
			'hide',
			'branch',
			'graph',
			'commit',
			'author',
			'datetime',
			'message',
			'changes',
			'files',
			'worktree',
		];

		const miniIconList = ['upstream-ahead', 'upstream-behind'];

		const elementLibrary: Record<string, ReactElement> = {};
		iconList.forEach(iconKey => {
			elementLibrary[iconKey] = createElement('span', { className: `graph-icon icon--${iconKey}` });
		});
		miniIconList.forEach(iconKey => {
			elementLibrary[iconKey] = createElement('span', { className: `graph-icon mini-icon icon--${iconKey}` });
		});
		//TODO: fix this once the styling is properly configured component-side
		elementLibrary.settings = createElement('span', {
			className: 'graph-icon icon--settings',
			style: { fontSize: '1.1rem', right: '0px', top: '-1px' },
		});
		return elementLibrary;
	};

	const iconElementLibrary = createIconElements();

	const getIconElementLibrary = (iconKey: string) => {
		return iconElementLibrary[iconKey];
	};
	return (
		<>
			<GraphContainer
				// {...state}
				avatarUrlByEmail={state.avatars}
				columnsSettings={state.columns}
				contexts={state.context}
				// @ts-expect-error returnType of formatCommitMessage callback expects to be string, but it works fine with react element
				formatCommitMessage={e => <GlMarkdown markdown={e}></GlMarkdown>}
				cssVariables={state.theming?.cssVariables}
				dimMergeCommits={state.config?.dimMergeCommits}
				downstreamsByUpstream={state.downstreams}
				enabledRefMetadataTypes={state.config?.enabledRefMetadataTypes}
				enabledScrollMarkerTypes={state.config?.scrollMarkerTypes}
				enableShowHideRefsOptions
				enableMultiSelection={state.config?.enableMultiSelection}
				excludeRefsById={state.excludeRefs}
				excludeByType={state.excludeTypes}
				// formatCommitDateTime={getGraphDateFormatter(graphConfig)}
				getExternalIcon={getIconElementLibrary}
				graphRows={state.rows ?? []}
				hasMoreCommits={state.paging?.hasMore}
				// Just cast the { [id: string]: number } object to { [id: string]: boolean } for performance
				// highlightedShas={state.searchResults?.ids as GraphContainerProps['highlightedShas']}
				highlightRowsOnRefHover={state.config?.highlightRowsOnRefHover}
				includeOnlyRefsById={state.includeOnlyRefs}
				scrollRowPadding={state.config?.scrollRowPadding}
				showGhostRefsOnRowHover={state.config?.showGhostRefsOnRowHover}
				showRemoteNamesOnRefs={state.config?.showRemoteNamesOnRefs}
				isContainerWindowFocused={state.windowFocused}
				isLoadingRows={state.loading}
				isSelectedBySha={state.selectedRows}
				nonce={state.nonce}
				// onColumnResized={handleOnColumnResized}
				// onDoubleClickGraphRow={handleOnDoubleClickRow}
				// onDoubleClickGraphRef={handleOnDoubleClickRef}
				// onGraphColumnsReOrdered={handleOnGraphColumnsReOrdered}
				// onGraphMouseLeave={handleOnGraphMouseLeave}
				// onGraphRowHovered={handleOnGraphRowHovered}
				// onGraphRowUnhovered={handleOnGraphRowUnhovered}
				// onRowContextMenu={handleRowContextMenu}
				// onSettingsClick={handleToggleColumnSettings}
				// onSelectGraphRows={handleSelectGraphRows}
				// onToggleRefsVisibilityClick={handleOnToggleRefsVisibilityClick}
				// onEmailsMissingAvatarUrls={handleMissingAvatars}
				// onRefsMissingMetadata={handleMissingRefsMetadata}
				// onShowMoreCommits={handleMoreCommits}
				// onGraphVisibleRowsChanged={minimap.current ? handleOnGraphVisibleRowsChanged : undefined}
				platform={clientPlatform}
				refMetadataById={state.refsMetadata}
				rowsStats={state.rowsStats}
				rowsStatsLoading={state.rowsStatsLoading}
				// searchMode={searchQuery?.filter ? 'filter' : 'normal'}
				shaLength={state.config?.idLength}
				shiftSelectMode="simple"
				suppressNonRefRowTooltips
				themeOpacityFactor={state.theming?.themeOpacityFactor}
				useAuthorInitialsForAvatars={!state.config?.avatars}
				workDirStats={state.workingTreeStats}
			/>
			{/* {Object.entries(state).map(([key, value]) => (
				<div key={key}>
					<span>{key}</span>
					<span>{JSON.stringify(value)}</span>
				</div>
			))} */}
		</>
	);
}

const forEachOrOne = (itemOrItems: string[] | string, callback: (item: string, index: number) => void) => {
	if (typeof itemOrItems === 'string') {
		callback(itemOrItems, 0);
	} else {
		itemOrItems.forEach(callback);
	}
};

function useEvent<T>(
	eventNameOrNames: string | string[],
	callback: (arg: T) => void,
	{ enabled = true }: { enabled?: boolean } = {},
) {
	useEffect(() => {
		if (!enabled) {
			return;
		}
		forEachOrOne(eventNameOrNames, eventName => {
			subscribe(eventName, callback);
		});
		return () => {
			forEachOrOne(eventNameOrNames, eventName => {
				unsubscribe(eventName, callback);
			});
		};
	}, [enabled, callback]);
}
