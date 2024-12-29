import { css } from 'lit';

export const timelineChartStyles = css`
	:host {
		display: block;
		position: relative;
		width: 100%;
		height: 100%;
	}

	#chart {
		position: absolute !important;
		height: 100%;
		width: 100%;
	}

	/* :host-context(:host[placement='view']) #chart {
		height: calc(100% - 0.4rem);
		width: calc(100% + 6.9rem);
		left: -3.5rem;
		bottom: 0.3rem;
	} */

	.bb svg {
		font: 10px sans-serif;
		-webkit-tap-highlight-color: rgba(0, 0, 0, 0);
	}

	.bb path,
	.bb line {
		fill: none;
	}

	:host-context(.vscode-dark) .bb path.domain,
	:host-context(.vscode-high-contrast:not(.vscode-high-contrast-light)) .bb path.domain {
		stroke: var(--color-background--lighten-15);
	}

	:host-context(.vscode-light) .bb path.domain,
	:host-context(.vscode-high-contrast-light) .bb path.domain {
		stroke: var(--color-background--darken-15);
	}

	.bb text,
	.bb .bb-button {
		user-select: none;
		fill: var(--color-view-foreground);
		font-size: 11px;
	}

	.bb .bb-legend-item-tile,
	.bb .bb-xgrid-focus,
	.bb .bb-ygrid-focus,
	.bb .bb-ygrid,
	.bb .bb-event-rect,
	.bb .bb-bars path {
		shape-rendering: crispEdges;
	}

	.bb .bb-chart-arc .bb-gauge-value {
		fill: #000;
	}

	.bb .bb-chart-arc path {
		stroke: #fff;
	}

	.bb .bb-chart-arc rect {
		stroke: #fff;
		stroke-width: 1;
	}

	.bb .bb-chart-arc text {
		fill: #fff;
		font-size: 13px;
	}

	.bb .bb-axis {
		shape-rendering: crispEdges;
	}

	.bb .bb-grid {
		pointer-events: none;
	}

	:host-context(.vscode-dark) .bb .bb-grid line,
	:host-context(.vscode-high-contrast:not(.vscode-high-contrast-light)) .bb .bb-grid line {
		stroke: var(--color-background--lighten-05);
	}

	:host-context(.vscode-dark) .bb .bb-grid line.bb-ygrid,
	:host-context(.vscode-high-contrast:not(.vscode-high-contrast-light)) .bb .bb-grid line.bb-ygrid {
		stroke: var(--color-background--lighten-05);
	}

	:host-context(.vscode-light) .bb .bb-grid line,
	:host-context(.vscode-high-contrast-light) .bb .bb-grid line {
		stroke: var(--color-background--darken-05);
	}

	:host-context(.vscode-light) .bb .bb-grid line.bb-ygrid,
	:host-context(.vscode-high-contrast-light) .bb .bb-grid line.bb-ygrid {
		stroke: var(--color-background--darken-05);
	}

	.bb .bb-grid text {
		fill: var(--color-view-foreground);
	}

	:host-context(.vscode-dark) .bb .bb-xgrid-focus line,
	:host-context(.vscode-high-contrast:not(.vscode-high-contrast-light)) .bb .bb-xgrid-focus line {
		stroke: var(--color-background--lighten-30);
	}

	:host-context(.vscode-light) .bb .bb-xgrid-focus line,
	:host-context(.vscode-high-contrast-light) .bb .bb-xgrid-focus line {
		stroke: var(--color-background--darken-30);
	}

	.bb .bb-text.bb-empty {
		fill: #808080;
		font-size: 2em;
	}

	.bb .bb-line {
		stroke-width: 1px;
	}

	.bb .bb-circle._expanded_ {
		opacity: 1 !important;
		fill-opacity: 1 !important;
		stroke-opacity: 1 !important;
		stroke-width: 3px;
	}

	.bb .bb-selected-circle {
		opacity: 1 !important;
		fill-opacity: 1 !important;
		stroke-opacity: 1 !important;
		stroke-width: 3px;
	}

	.bb .bb-bar {
		stroke-width: 0;
		opacity: 0.9 !important;
		fill-opacity: 0.9 !important;
	}

	.bb .bb-bar._expanded_ {
		opacity: 1 !important;
		fill-opacity: 1 !important;
	}

	.bb .bb-candlestick {
		stroke-width: 1px;
	}

	.bb .bb-candlestick._expanded_ {
		fill-opacity: 0.75;
	}

	.bb .bb-target.bb-focused,
	.bb .bb-circles.bb-focused {
		opacity: 1;
	}

	.bb .bb-target.bb-focused path.bb-line,
	.bb .bb-target.bb-focused path.bb-step,
	.bb .bb-circles.bb-focused path.bb-line,
	.bb .bb-circles.bb-focused path.bb-step {
		stroke-width: 2px;
	}

	.bb .bb-target.bb-defocused,
	.bb .bb-circles.bb-defocused {
		opacity: 0.2 !important;
	}

	.bb .bb-target.bb-defocused .text-overlapping,
	.bb .bb-circles.bb-defocused .text-overlapping {
		opacity: 0.05 !important;
	}

	.bb .bb-region {
		fill: steelblue;
		fill-opacity: 0.1;
	}

	:host-context(.vscode-dark) .bb .bb-zoom-brush,
	:host-context(.vscode-high-contrast:not(.vscode-high-contrast-light)) .bb .bb-zoom-brush {
		fill: white;
		fill-opacity: 0.2;
	}

	:host-context(.vscode-light) .bb .bb-zoom-brush,
	:host-context(.vscode-high-contrast-light) .bb .bb-zoom-brush {
		fill: black;
		fill-opacity: 0.1;
	}

	.bb .bb-brush .extent {
		fill-opacity: 0.1;
	}

	.bb .bb-legend-item {
		font-size: 12px;
		user-select: none;
	}

	.bb .bb-legend-item-hidden {
		opacity: 0.15;
	}

	.bb .bb-legend-background {
		opacity: 0.75;
		fill: white;
		stroke: lightgray;
		stroke-width: 1;
	}

	.bb .bb-title {
		font: 14px sans-serif;
	}

	.bb .bb-tooltip-container {
		z-index: 10;
		user-select: none;
	}

	.bb .bb-area {
		stroke-width: 0;
		opacity: 0.2;
	}

	.bb .bb-chart-arcs-title {
		dominant-baseline: middle;
		font-size: 1.3em;
	}

	.bb text.bb-chart-arcs-gauge-title {
		dominant-baseline: middle;
		font-size: 2.7em;
	}

	.bb .bb-chart-arcs .bb-chart-arcs-background {
		fill: #e0e0e0;
		stroke: #fff;
	}

	.bb .bb-chart-arcs .bb-chart-arcs-gauge-unit {
		fill: #000;
		font-size: 16px;
	}

	.bb .bb-chart-arcs .bb-chart-arcs-gauge-max {
		fill: #777;
	}

	.bb .bb-chart-arcs .bb-chart-arcs-gauge-min {
		fill: #777;
	}

	.bb .bb-chart-radars .bb-levels polygon {
		fill: none;
		stroke: #848282;
		stroke-width: 0.5px;
	}

	.bb .bb-chart-radars .bb-levels text {
		fill: #848282;
	}

	.bb .bb-chart-radars .bb-axis line {
		stroke: #848282;
		stroke-width: 0.5px;
	}

	.bb .bb-chart-radars .bb-axis text {
		font-size: 1.15em;
		cursor: default;
	}

	.bb .bb-chart-radars .bb-shapes polygon {
		fill-opacity: 0.2;
		stroke-width: 1px;
	}

	.bb .bb-button {
		position: absolute;
		top: 0.4rem;
		right: -1.4rem;
		background-color: var(--color-button-background);
		color: var(--color-button-foreground);
		font-size: var(--font-size);
		font-family: var(--font-family);
	}

	:host-context(:host[placement='view']) .bb .bb-button {
		margin-right: 2.8rem;
	}

	.bb .bb-zoom-reset {
		display: inline-block;
		padding: 0.5rem 1rem;
		cursor: pointer;
	}

	.empty {
		padding: 0.4rem 2rem 1.3rem 2rem;
		font-size: var(--font-size);
	}

	.empty p {
		margin-top: 0;
	}

	.bb-tooltip {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background-color: var(--color-hover-background);
		color: var(--color-hover-foreground);
		border: 1px solid var(--color-hover-border);
		box-shadow: 0 2px 8px var(--vscode-widget-shadow);
		font-size: var(--font-size);
		opacity: 1;
		white-space: nowrap;
		min-width: 0;
		max-width: 360px;
		overflow: hidden;
	}

	.bb-tooltip .author {
		font-weight: 600;
	}

	.bb-tooltip .additions {
		color: var(--vscode-gitDecoration-addedResourceForeground);
	}

	.bb-tooltip .deletions {
		color: var(--vscode-gitDecoration-deletedResourceForeground);
	}

	.bb-tooltip .date {
		flex: 1 1 auto;
		display: inline-flex;
		flex-direction: row;
		align-items: center;
		justify-content: flex-start;
		font-weight: normal;
		gap: 0.5rem;
		min-width: 0;
	}

	.bb-tooltip .date--relative {
		flex: 0 1 auto;
	}

	.bb-tooltip .date--absolute {
		flex: 0 100000 auto;
		font-style: italic;
	}

	.bb-tooltip .message {
		margin-left: 2rem;
		margin-top: 0.5rem;
		margin-bottom: 0.5rem;
		max-height: 12rem;
		overflow-y: auto;
		overflow-x: hidden;
	}

	.bb-tooltip .message__content {
		white-space: pre-line;
	}
`;
