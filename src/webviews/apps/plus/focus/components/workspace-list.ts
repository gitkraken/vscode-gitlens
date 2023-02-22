import { css, customElement, FASTElement, html } from '@microsoft/fast-element';
import { srOnly } from '../../../shared/components/styles/a11y';
import { elementBase } from '../../../shared/components/styles/base';

import '../../../shared/components/table/table-container';
import '../../../shared/components/table/table-row';
import '../../../shared/components/table/table-cell';

const template = html<WorkspaceList>`
	<table-container>
		<table-row slot="head">
			<table-cell header="column" pinned class="sr-only">Row selection</table-cell>
			<table-cell header="column" pinned>Workspace</table-cell>
			<table-cell header="column" pinned>Description</table-cell>
			<table-cell header="column" pinned># of repos</table-cell>
			<table-cell header="column" pinned>Latest update</table-cell>
			<table-cell header="column" pinned>Shared with</table-cell>
			<table-cell header="column" pinned>Owner</table-cell>
			<table-cell header="column" pinned><span class="sr-only">Workspace actions</span></table-cell>
		</table-row>
		<slot>
			<table-row>
				<table-cell class="sr-only"></table-cell>
				<table-cell>No workspaces</table-cell>
				<table-cell></table-cell>
				<table-cell></table-cell>
				<table-cell></table-cell>
				<table-cell></table-cell>
				<table-cell></table-cell>
				<table-cell></table-cell>
			</table-row>
		</slot>
	</table-container>
`;

const styles = css`
	${elementBase}

	.row {
		display: table-row;
	}

	${srOnly}
`;

@customElement({ name: 'workspace-list', template: template, styles: styles })
export class WorkspaceList extends FASTElement {}
