import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { suite, test } from 'mocha';

// `constants.ts` is a public subpath that webviews import directly, so it must stay free of runtime imports.
// Compares against the source file, found relative to this one (`out/__tests__/` when bundled, `src/__tests__/` when
// not), so it doesn't depend on the working directory.
suite('constants.ts has no runtime imports', () => {
	test('every import and re-export is type-only', () => {
		const source = readFileSync(join(__dirname, '..', '..', 'src', 'constants.ts'), 'utf8');

		// Strip comments so a commented-out import isn't a false positive.
		const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

		const offenders = [
			// `import x from`, `import { a } from`, `import * as x from`, side-effect `import 'x'`, and `import('x')`
			...code.matchAll(/^\s*import\s+(?!type\b)[^;]*?(?:from\s+)?['"][^'"]+['"]/gm),
			...code.matchAll(/\bimport\s*\(/g),
			// `export { a } from`, `export * from`
			...code.matchAll(/^\s*export\s+(?!type\b)(?:\*|\{[^}]*\})[^;]*?\bfrom\s+['"][^'"]+['"]/gm),
		].map(m => m[0].trim());

		assert.deepEqual(offenders, [], `constants.ts must not have runtime imports: ${offenders.join('; ')}`);
	});
});
