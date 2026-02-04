import { css } from 'lit';

export const welcomeBaseStyles = css`
	* {
		box-sizing: border-box;
	}

	:not(:defined) {
		visibility: hidden;
	}

	[hidden] {
		display: none !important;
	}

	/* roll into shared focus style */
	:focus-visible {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
`;

// 	b {
// 		font-weight: 600;
// 	}

// 	p {
// 		margin-top: 0;
// 	}

// 	ul {
// 		margin-top: 0;
// 		padding-left: 1.2em;
// 	}

// 	.welcome {
// 		padding: 0;
// 		height: 100vh;
// 		display: flex;
// 		flex-direction: column;
// 		overflow: hidden;
// 	}

// 	gl-welcome-page {
// 		flex: 1;
// 		overflow: auto;
// 	}
// `;
