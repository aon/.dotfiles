# Dotfiles

Use `stow` from inside this directory:

```sh
stow -t "$HOME" .
```

Dry run:

```sh
stow -nv -t "$HOME" .
```

Unstow:

```sh
stow -D -t "$HOME" .
```
