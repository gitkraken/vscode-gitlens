## Visual Interactive Rebase

<p align="center">
  <img src="../../images/docs/rebase.gif" alt="Interactive rebase editor"/>
</p>

Simply drag & drop to reorder commits and select which ones you want to edit, squash, or drop.

To use this directly from your terminal, e.g. when running `git rebase -i`,

- set VS Code as your default Git editor
  - `git config --global core.editor "code --wait"`
- or, to only affect rebase, set VS Code as your Git rebase editor
  - `git config --global sequence.editor "code --wait"`

> To use the Insiders edition of VS Code, replace `code` in the above with `code-insiders`
