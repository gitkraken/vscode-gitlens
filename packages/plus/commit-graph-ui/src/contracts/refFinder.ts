import type { TemplateResult } from 'lit';
import type { Ref } from 'lit/directives/ref.js';

export interface GraphRefFinderElement extends HTMLElement {
	focus(options?: FocusOptions): void;
}

export interface GraphRefFinderRenderContext {
	elementRef: Ref<GraphRefFinderElement>;
	open: boolean;
	openedBy: 'shortcut' | 'button';
	getRowIndex: (sha: string) => number | undefined;
	rowsLoaded: number;
	onClick: (event: Event) => void;
	onJump: (event: CustomEvent<{ sha: string; focus: boolean; refKey?: string; handoff?: boolean }>) => void;
	onClose: () => void;
}

/** Cold, profile-selected ref finder. Called once per surface render, never per graph row. */
export type GraphRefFinderRenderer = (context: GraphRefFinderRenderContext) => TemplateResult;
