/* eslint-disable no-restricted-imports */
import path from 'path';
import type { Options } from '@wdio/types';
import { dirName } from './constants/filepaths.ts';

const isDebugging = process.env.DEBUG === '1';

export const config: Options.Testrunner = {
	runner: 'local',
	autoCompileOpts: {
		autoCompile: true,
		tsNodeOpts: {
			project: './tsconfig.json',
			transpileOnly: true,
		},
	},

	specs: ['./specs/**/*.ts'],
	debug: isDebugging,
	execArgv: isDebugging ? ['--inspect'] : [],
	maxInstances: isDebugging ? 1 : 10,
	capabilities: [
		{
			browserName: 'vscode', // isDebugging ? 'chrome' : 'vscode',
			browserVersion: 'stable', // also possible: "insiders" or a specific version e.g. "1.80.0"
			'wdio:vscodeOptions': {
				extensionPath: dirName,
				workspacePath: dirName,
				filePath: path.join(dirName, 'README.md'),
				userSettings: {
					'editor.fontSize': 14,
				},
				vscodeArgs: {
					noSandbox: true,
					disableUpdates: true,
					skipWelcome: true,
					skipReleaseNotes: true,
					disableWorkspaceTrust: true,
					disableExtensions: false,
				},
			},
		},
	],
	logLevel: 'error',
	outputDir: 'tests/wdio/logs',
	bail: 0,
	waitForTimeout: 20000,
	connectionRetryTimeout: 120000,
	connectionRetryCount: 3,
	//
	// Test runner services
	// Services take over a specific job you don't want to take care of. They enhance
	// your test setup with almost no effort. Unlike plugins, they don't add new
	// commands. Instead, they hook themselves up into the test process.
	services: ['vscode'],
	// Framework you want to run your specs with.
	// The following are supported: Mocha, Jasmine, and Cucumber
	// see also: https://webdriver.io/docs/frameworks
	//
	// Make sure you have the wdio adapter package for the specific framework installed
	// before running any tests.
	framework: 'mocha',
	// Test reporter for stdout.
	// The only one supported by default is 'dot'
	// see also: https://webdriver.io/docs/dot-reporter
	reporters: ['spec'],
	// Options to be passed to Mocha.
	// See the full list at http://mochajs.org/
	mochaOpts: {
		ui: 'bdd',
		timeout: 20000,
	},
	//
	// =====
	// Hooks
	// =====
	// WebdriverIO provides several hooks you can use to interfere with the test process in order to enhance
	// it and to build services around it. You can either apply a single function or an array of
	// methods to it. If one of them returns with a promise, WebdriverIO will wait until that promise got
	// resolved to continue.
	/**
	 * Gets executed once before all workers get launched.
	 * @param {object} config wdio configuration object
	 * @param {Array.<Object>} capabilities list of capabilities details
	 */
	// onPrepare: function (config, capabilities) {
	// },
	/**
	 * Gets executed before a worker process is spawned and can be used to initialize specific service
	 * for that worker as well as modify runtime environments in an async fashion.
	 * @param  {string} cid      capability id (e.g 0-0)
	 * @param  {object} caps     object containing capabilities for session that will be spawn in the worker
	 * @param  {object} specs    specs to be run in the worker process
	 * @param  {object} args     object that will be merged with the main configuration once worker is initialized
	 * @param  {object} execArgv list of string arguments passed to the worker process
	 */
	// onWorkerStart: function (cid, caps, specs, args, execArgv) {
	// },
	/**
	 * Gets executed just after a worker process has exited.
	 * @param  {string} cid      capability id (e.g 0-0)
	 * @param  {number} exitCode 0 - success, 1 - fail
	 * @param  {object} specs    specs to be run in the worker process
	 * @param  {number} retries  number of retries used
	 */
	// onWorkerEnd: function (cid, exitCode, specs, retries) {
	// },
	/**
	 * Gets executed just before initialising the webdriver session and test framework. It allows you
	 * to manipulate configurations depending on the capability or spec.
	 * @param {object} config wdio configuration object
	 * @param {Array.<Object>} capabilities list of capabilities details
	 * @param {Array.<String>} specs List of spec file paths that are to be run
	 * @param {string} cid worker id (e.g. 0-0)
	 */
	// beforeSession: function (config, capabilities, specs, cid) {
	// },
	/**
	 * Gets executed before test execution begins. At this point you can access to all global
	 * variables like `browser`. It is the perfect place to define custom commands.
	 * @param {Array.<Object>} capabilities list of capabilities details
	 * @param {Array.<String>} specs        List of spec file paths that are to be run
	 * @param {object}         browser      instance of created browser/device session
	 */
	// before: function (capabilities, specs) {
	// },
	/**
	 * Runs before a WebdriverIO command gets executed.
	 * @param {string} commandName hook command name
	 * @param {Array} args arguments that command would receive
	 */
	// beforeCommand: function (commandName, args) {
	// },
	/**
	 * Hook that gets executed before the suite starts
	 * @param {object} suite suite details
	 */
	// beforeSuite: function (suite) {
	// },
	/**
	 * Function to be executed before a test (in Mocha/Jasmine) starts.
	 */
	// beforeTest: function (test, context) {
	// },
	/**
	 * Hook that gets executed _before_ a hook within the suite starts (e.g. runs before calling
	 * beforeEach in Mocha)
	 */
	// beforeHook: function (test, context, hookName) {
	// },
	/**
	 * Hook that gets executed _after_ a hook within the suite starts (e.g. runs after calling
	 * afterEach in Mocha)
	 */
	// afterHook: function (test, context, { error, result, duration, passed, retries }, hookName) {
	// },
	/**
	 * Function to be executed after a test (in Mocha/Jasmine only)
	 * @param {object}  test             test object
	 * @param {object}  context          scope object the test was executed with
	 * @param {Error}   result.error     error object in case the test fails, otherwise `undefined`
	 * @param {*}       result.result    return object of test function
	 * @param {number}  result.duration  duration of test
	 * @param {boolean} result.passed    true if test has passed, otherwise false
	 * @param {object}  result.retries   information about spec related retries, e.g. `{ attempts: 0, limit: 0 }`
	 */
	// afterTest: function(test, context, { error, result, duration, passed, retries }) {
	// },
	/**
	 * Hook that gets executed after the suite has ended
	 * @param {object} suite suite details
	 */
	// afterSuite: function (suite) {
	// },
	/**
	 * Runs after a WebdriverIO command gets executed
	 * @param {string} commandName hook command name
	 * @param {Array} args arguments that command would receive
	 * @param {number} result 0 - command success, 1 - command error
	 * @param {object} error error object if any
	 */
	// afterCommand: function (commandName, args, result, error) {
	// },
	/**
	 * Gets executed after all tests are done. You still have access to all global variables from
	 * the test.
	 * @param {number} result 0 - test pass, 1 - test fail
	 * @param {Array.<Object>} capabilities list of capabilities details
	 * @param {Array.<String>} specs List of spec file paths that ran
	 */
	// after: function (result, capabilities, specs) {
	// },
	/**
	 * Gets executed right after terminating the webdriver session.
	 * @param {object} config wdio configuration object
	 * @param {Array.<Object>} capabilities list of capabilities details
	 * @param {Array.<String>} specs List of spec file paths that ran
	 */
	// afterSession: function (config, capabilities, specs) {
	// },
	/**
	 * Gets executed after all workers got shut down and the process is about to exit. An error
	 * thrown in the onComplete hook will result in the test run failing.
	 * @param {object} exitCode 0 - success, 1 - fail
	 * @param {object} config wdio configuration object
	 * @param {Array.<Object>} capabilities list of capabilities details
	 * @param {<Object>} results object containing test results
	 */
	// onComplete: function(exitCode, config, capabilities, results) {
	// },
	/**
	 * Gets executed when a refresh happens.
	 * @param {string} oldSessionId session ID of the old session
	 * @param {string} newSessionId session ID of the new session
	 */
	// onReload: function(oldSessionId, newSessionId) {
	// }
	/**
	 * Hook that gets executed before a WebdriverIO assertion happens.
	 * @param {object} params information about the assertion to be executed
	 */
	// beforeAssertion: function(params) {
	// }
	/**
	 * Hook that gets executed after a WebdriverIO assertion happened.
	 * @param {object} params information about the assertion that was executed, including its results
	 */
	// afterAssertion: function(params) {
	// }
};
