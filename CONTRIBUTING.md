# Contributing

👍🎉 First off, thanks for taking the time to contribute! 🎉👍

When contributing to this project, please first discuss the changes you wish to make via an issue before making changes.

Please note the [Code of Conduct](CODE_OF_CONDUCT.md) document, please follow it in all your interactions with this project.

## Your First Code Contribution

Unsure where to begin contributing? You can start by looking through the [`help-wanted`](https://github.com/eamodio/vscode-gitlens/labels/help%20wanted) issues.

### Getting the code

```
git clone https://github.com/eamodio/vscode-gitlens.git
```

Prerequisites

- [Git](https://git-scm.com/)
- [NodeJS](https://nodejs.org/en/), `>= 8.9.1, < 9.0.0`
- [npm](https://npmjs.com/), `>= 6.2.0`

### Dependencies

From a terminal, where you have cloned the repository, execute the following command to install the required dependencies:

```
npm install --no-save
```

### Build

From a terminal, where you have cloned the repository, execute the following command to re-build the project from scratch:

```
npm run rebuild
```

👉 **NOTE!** This will run a complete rebuild of the project.

Or to just run a quick build, use:

```
npm run build
```

### Watch

During development you can use a watcher to make builds on changes quick and easy. From a terminal, where you have cloned the repository, execute the following command:

```
npm run watch
```

Or use the provided `watch` task in VS Code, execute the following from the command palette (be sure there is no `>` at the start):

```
task watch
```

This will first do an initial full build and then watch for file changes, compiling those changes incrementally, enabling a fast, iterative coding experience.

👉 **Tip!** You can press <kbd>CMD+SHIFT+B</kbd> (<kbd>CTRL+SHIFT+B</kbd> on Windows, Linux) to start the watch task.

👉 **Tip!** You don't need to stop and restart the development version of Code after each change. You can just execute `Reload Window` from the command palette.

### Formatting

This project uses [prettier](https://prettier.io/) for code formatting. You can run prettier across the code by calling `npm run pretty` from a terminal.

To format the code as you make changes you can install the [Prettier - Code formatter](https://marketplace.visualstudio.com/items/esbenp.prettier-vscode) extension.

Add the following to your User Settings to run prettier:

```
"editor.formatOnSave": true,
```

### Linting

This project uses [tslint](https://palantir.github.io/tslint/) for code linting. You can run tslint across the code by calling `npm run lint` from a terminal. Warnings from tslint show up in the `Errors and Warnings` quick box and you can navigate to them from inside VS Code.

To lint the code as you make changes you can install the [TypeScript TSLint Plugin](https://marketplace.visualstudio.com/items?itemName=ms-vscode.vscode-typescript-tslint-plugin) extension.

### Bundling

To generate a production bundle (without packaging) run the following from a terminal:

```
npm run bundle
```

To generate a VSIX (installation package) run the following from a terminal:

```
npm run pack
```

### Debugging

#### Using VS Code

1. Open the `vscode-gitlens` folder
2. Ensure the required [dependencies](#dependencies) are installed
3. Start the [`watch`](#watch) task
4. Choose the `Launch GitLens` launch configuration from the launch dropdown in the Debug viewlet and press `F5`.

## Submitting a Pull Request

Please follow all the instructions in the [PR template](.github/PULL_REQUEST_TEMPLATE.md).
