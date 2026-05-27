import { html, nothing } from 'lit';
import '../code-icon.js';
import '../overlays/tooltip.js';

/** Renders the working-state `[tools icon] Bash(grep …)` composite: leading tools codicon +
 *  monospace call text, wrapped in a tooltip that surfaces the full untruncated value on hover.
 *  Apply `agentToolStyles` to the host's `static styles` array so the `agent-tool*` classes pick
 *  up the shared layout rules. Returns `nothing` when no detail is available. */
export function renderRunningTool(statusDetail: string | undefined): unknown {
	if (statusDetail == null) return nothing;

	return html`<gl-tooltip content=${statusDetail} placement="bottom">
		<span class="agent-tool">
			<code-icon class="agent-tool__icon" icon="tools"></code-icon>
			<span class="agent-tool__text">${statusDetail}</span>
		</span>
	</gl-tooltip>`;
}
