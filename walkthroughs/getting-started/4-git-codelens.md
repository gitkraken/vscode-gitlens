## Git CodeLens

<p align="center">
  <img src="../../images/docs/code-lens.png" alt="Git CodeLens" />
</p>

Adds Git authorship **CodeLens** to the top of the file and on code blocks

- **Recent Change** &mdash; author and date of the most recent commit for the file or code block
  - Click the CodeLens to show a **commit file details quick pick menu** with commands for comparing, navigating and exploring commits, and more (by [default](#git-codelens-settings- 'Jump to the Git CodeLens settings'))
- **Authors** &mdash; number of authors of the file or code block and the most prominent author (if there is more than one)

  - Click the CodeLens to toggle the file Git blame annotations on and off of the whole file (by [default](#git-codelens-settings- 'Jump to the Git CodeLens settings'))
  - Will be hidden if the author of the most recent commit is also the only author of the file or block, to avoid duplicate information and reduce visual noise

- Provides [customizable](command:gitlens.showSettingsPage?%22code-lens%22 'Jump to the Git CodeLens settings') click behavior for each CodeLens &mdash; choose between one of the following

  - Toggle file blame annotations on and off
  - Compare the commit with the previous commit
  - Show a quick pick menu with details and commands for the commit
  - Show a quick pick menu with file details and commands for the commit
  - Show a quick pick menu with the commit history of the file
  - Show a quick pick menu with the commit history of the current branch

- Adds a _Toggle Git CodeLens_ command (`gitlens.toggleCodeLens`) with a shortcut of `shift+alt+b` to toggle the CodeLens on and off
