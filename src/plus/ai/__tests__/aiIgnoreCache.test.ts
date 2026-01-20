import * as assert from 'assert';

// Test the default exclusion patterns directly since AIIgnoreCache requires Container
// These patterns should match the defaultExcludeFiles in aiIgnoreCache.ts

const defaultExcludePatterns = [
	// Lock files
	'**/pnpm-lock.yaml',
	'**/package-lock.json',
	'**/yarn.lock',
	'**/Cargo.lock',
	'**/Gemfile.lock',
	'**/composer.lock',
	'**/Pipfile.lock',
	'**/poetry.lock',
	'**/go.sum',
	// Minified files
	'**/*.min.js',
	'**/*.min.css',
	// Source maps
	'**/*.map',
	// Build outputs
	'**/dist/**',
	'**/out/**',
	'**/build/**',
	'**/node_modules/**',
];

// Simple glob matcher for testing (supports ** and * patterns)
function matchesGlob(path: string, pattern: string): boolean {
	// Convert glob pattern to regex
	const regexStr = pattern
		// Escape special regex chars except * and /
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		// Handle trailing ** (matches anything after)
		.replace(/\*\*$/, '<<<TRAILING>>>')
		// Convert ** to match any path segment(s) including empty
		.replace(/\*\*\//g, '(?:.*/)?')
		// Convert * to match within a single segment
		.replace(/\*/g, '[^/]*')
		// Replace trailing globstar
		.replace(/<<<TRAILING>>>/, '.*');

	const regex = new RegExp(`(^|/)${regexStr}$`);
	return regex.test(path);
}

function isExcludedByDefaults(path: string): boolean {
	return defaultExcludePatterns.some(pattern => matchesGlob(path, pattern));
}

suite('AIIgnoreCache Default Patterns Test Suite', () => {
	suite('Lock files', () => {
		test('excludes pnpm-lock.yaml', () => {
			assert.ok(isExcludedByDefaults('pnpm-lock.yaml'));
			assert.ok(isExcludedByDefaults('some/nested/pnpm-lock.yaml'));
		});

		test('excludes package-lock.json', () => {
			assert.ok(isExcludedByDefaults('package-lock.json'));
			assert.ok(isExcludedByDefaults('packages/app/package-lock.json'));
		});

		test('excludes yarn.lock', () => {
			assert.ok(isExcludedByDefaults('yarn.lock'));
			assert.ok(isExcludedByDefaults('frontend/yarn.lock'));
		});

		test('excludes Cargo.lock', () => {
			assert.ok(isExcludedByDefaults('Cargo.lock'));
			assert.ok(isExcludedByDefaults('rust/project/Cargo.lock'));
		});

		test('excludes Gemfile.lock', () => {
			assert.ok(isExcludedByDefaults('Gemfile.lock'));
			assert.ok(isExcludedByDefaults('ruby/app/Gemfile.lock'));
		});

		test('excludes composer.lock', () => {
			assert.ok(isExcludedByDefaults('composer.lock'));
			assert.ok(isExcludedByDefaults('php/project/composer.lock'));
		});

		test('excludes Pipfile.lock', () => {
			assert.ok(isExcludedByDefaults('Pipfile.lock'));
			assert.ok(isExcludedByDefaults('python/app/Pipfile.lock'));
		});

		test('excludes poetry.lock', () => {
			assert.ok(isExcludedByDefaults('poetry.lock'));
			assert.ok(isExcludedByDefaults('python/project/poetry.lock'));
		});

		test('excludes go.sum', () => {
			assert.ok(isExcludedByDefaults('go.sum'));
			assert.ok(isExcludedByDefaults('services/api/go.sum'));
		});
	});

	suite('Minified files', () => {
		test('excludes .min.js files', () => {
			assert.ok(isExcludedByDefaults('app.min.js'));
			assert.ok(isExcludedByDefaults('dist/bundle.min.js'));
			assert.ok(isExcludedByDefaults('vendor/jquery.min.js'));
		});

		test('excludes .min.css files', () => {
			assert.ok(isExcludedByDefaults('styles.min.css'));
			assert.ok(isExcludedByDefaults('assets/theme.min.css'));
		});

		test('does not exclude regular js/css files', () => {
			assert.ok(!isExcludedByDefaults('src/app.js'));
			assert.ok(!isExcludedByDefaults('styles/main.css'));
		});
	});

	suite('Source maps', () => {
		test('excludes .map files', () => {
			assert.ok(isExcludedByDefaults('app.js.map'));
			assert.ok(isExcludedByDefaults('dist/bundle.js.map'));
			assert.ok(isExcludedByDefaults('styles.css.map'));
		});
	});

	suite('Build output directories', () => {
		test('excludes dist/ files', () => {
			assert.ok(isExcludedByDefaults('dist/index.js'));
			assert.ok(isExcludedByDefaults('dist/nested/file.ts'));
			assert.ok(isExcludedByDefaults('packages/lib/dist/output.js'));
		});

		test('excludes out/ files', () => {
			assert.ok(isExcludedByDefaults('out/extension.js'));
			assert.ok(isExcludedByDefaults('out/test/file.js'));
		});

		test('excludes build/ files', () => {
			assert.ok(isExcludedByDefaults('build/app.js'));
			assert.ok(isExcludedByDefaults('packages/core/build/index.js'));
		});

		test('excludes node_modules/ files', () => {
			assert.ok(isExcludedByDefaults('node_modules/lodash/index.js'));
			assert.ok(isExcludedByDefaults('packages/app/node_modules/react/index.js'));
		});
	});

	suite('Source files are NOT excluded', () => {
		test('does not exclude TypeScript files', () => {
			assert.ok(!isExcludedByDefaults('src/main.ts'));
			assert.ok(!isExcludedByDefaults('src/utils/helper.ts'));
		});

		test('does not exclude JavaScript files', () => {
			assert.ok(!isExcludedByDefaults('src/app.js'));
			assert.ok(!isExcludedByDefaults('lib/utils.js'));
		});

		test('does not exclude config files', () => {
			assert.ok(!isExcludedByDefaults('package.json'));
			assert.ok(!isExcludedByDefaults('tsconfig.json'));
			assert.ok(!isExcludedByDefaults('.eslintrc.json'));
		});

		test('does not exclude README', () => {
			assert.ok(!isExcludedByDefaults('README.md'));
		});
	});
});
