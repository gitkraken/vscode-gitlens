import noSrcImports from './eslint-rules/no-src-imports.mjs';
import noSelfPackageImports from './eslint-rules/no-self-package-imports.mjs';
import noEnvWithoutJs from './eslint-rules/no-env-without-js.mjs';
import logScopeUsage from './eslint-rules/scoped-logger-usage.mjs';
import requireBlockBody from './eslint-rules/require-block-body.mjs';
import newlineAfterControlFlow from './eslint-rules/newline-after-control-flow.mjs';

export default {
	rules: {
		'no-src-imports': noSrcImports,
		'no-self-package-imports': noSelfPackageImports,
		'no-env-without-js': noEnvWithoutJs,
		'scoped-logger-usage': logScopeUsage,
		'require-block-body': requireBlockBody,
		'newline-after-control-flow': newlineAfterControlFlow,
	},
};
