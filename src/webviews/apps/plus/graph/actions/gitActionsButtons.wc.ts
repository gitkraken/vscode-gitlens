import r2wc from '@r2wc/react-to-web-component';
import { GitActionsButtons } from './gitActionsButtons';

const GitActionsButtonsWC = r2wc(GitActionsButtons, {
	props: {
		branchName: 'string',
		branchState: 'string',
		lastFetched: 'json',
		state: 'json',
	},
});

customElements.define('gl-git-actions-buttons', GitActionsButtonsWC);
