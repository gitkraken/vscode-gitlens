//
// Note: This example test is leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
// import * as vscode from 'vscode';
// import * as myExtension from '../src/extension';

// Defines a Mocha test suite to group tests of similar kind together
suite('Extension Tests', () => {
	// Defines a Mocha unit test
	test('Something 1', () => {
		assert.equal(-1, [1, 2, 3].indexOf(5));
		assert.equal(-1, [1, 2, 3].indexOf(0));
	});
});

// import { CreatePullRequestActionContext, OpenPullRequestActionContext } from '../src/api/gitlens';

// api.registerActionRunner('openPullRequest', {
// 	label: 'Test Runner',
// 	run: function (context: OpenPullRequestActionContext) {
// 		console.log(context);
// 	},
// });

// api.registerActionRunner('createPullRequest', {
// 	label: 'Test Runner 1',
// 	run: function (context: CreatePullRequestActionContext) {
// 		console.log('Test Runner 1', context);
// 	},
// });

// api.registerActionRunner('createPullRequest', {
// 	label: 'Test Runner 2',
// 	run: function (context: CreatePullRequestActionContext) {
// 		console.log('Test Runner 2', context);
// 	},
// });
