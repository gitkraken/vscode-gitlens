import { eslintCompatPlugin } from '@oxlint/plugins';
import newlineAfterControlFlow from './eslint-rules/newline-after-control-flow.mjs';
import noInstanceofCancellationError from './eslint-rules/no-instanceof-cancellation-error.mjs';
import noSelfPackageImports from './eslint-rules/no-self-package-imports.mjs';
import noSrcImports from './eslint-rules/no-src-imports.mjs';
import oneVar from './eslint-rules/one-var.mjs';
import requireBlockBody from './eslint-rules/require-block-body.mjs';
import requireJsExtension from './eslint-rules/require-js-extension.mjs';
import logScopeUsage from './eslint-rules/scoped-logger-usage.mjs';

// Rules are authored with oxlint's `createOnce` API; `eslintCompatPlugin` synthesizes a `create`
// for each so the same plugin runs under both oxlint (native) and ESLint.
export default eslintCompatPlugin({
	meta: { name: '@gitlens' },
	rules: {
		'no-src-imports': noSrcImports,
		'no-self-package-imports': noSelfPackageImports,
		'no-instanceof-cancellation-error': noInstanceofCancellationError,
		'one-var': oneVar,
		'require-js-extension': requireJsExtension,
		'scoped-logger-usage': logScopeUsage,
		'require-block-body': requireBlockBody,
		'newline-after-control-flow': newlineAfterControlFlow,
	},
});
