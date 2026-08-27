# Brief template — direct mode

For small, fully-specified changes: toolchain and CI config, a rename, a copy change, a dependency
bump, a one-file fix. If the Scope cannot spell out the diff, use `brief-template-architect.md`
instead — that is architect work, not this.

Copy this into `<scratchpad>/brief-<slug>.md`, fill every section, delete nothing. Replace the
guidance in each section with real content — an empty or hand-waved section is where the delegated
agent goes off the rails.

**Alcance** carries the whole task here: there is no architect behind it re-deriving what to do. Name
every file and what it becomes. Whatever you leave vague, the agent decides alone and unsupervised.

---

# <Task title>

Sos el agente responsable de esta tarea en este worktree. El cambio es chico y ya está especificado:
implementalo a mano, verificá, y abrí el PR con la skill `pr`. **No lances la skill
`implement-with-architect`** — para este tamaño es puro overhead. Trabajás sin supervisión: no preguntes, decidí y avanzá.

## Ejecución

1. Implementá el `Alcance` de abajo, tal cual está escrito.
2. Verificá desde la raíz del repo: `pnpm check` y después `pnpm test`, los dos en verde. Si algo
   falla, arreglá la causa; nunca borres ni debilites un test para que pase.
3. Commiteá con prefijo de conventional commit (`chore:`, `fix:`, `feat:`, …) y pusheá con upstream.
   Sin trailer `Co-Authored-By`.
4. Corré la skill `pr`: `Skill({ skill: "pr" })`. Escribe el cuerpo siguiendo el template del repo,
   abre el pull request y se queda hasta que el CI esté en verde. No abras el PR a mano ni actives
   automerge.

Si `pnpm check` o `pnpm test` no llegan a verde, **no abras el PR**: dejá el bloqueo en el
comentario del worktree y frená.

## Tarea

<One imperative sentence: what must be true when you are done.>

## Contexto

<Why this task exists: the incident, the review finding, the user request. Include issue/PR numbers,
Sentry short-ids, links. Name the files and symbols already located — full repo-relative paths.
Anything you already verified so the agent does not re-investigate it, marked as such. Reference
artifacts (specs, diffs, logs) by path or URL; do not paste them.>

## Alcance

Incluye:

- <file path> — <what it becomes, concretely: the new content, the exact line that changes>
- <file path> — <...>

Fuera de alcance (decidido, no lo revisites):

- <thing deliberately left out, and why in half a line>

## Estado actual del worktree

<Branch and base commit. Anything already staged or applied here. If nothing: "Worktree limpio,
basado en origin/main.">

## Criterios de aceptación

- <observable outcome, not an implementation step>
- `pnpm check` y `pnpm test` verdes desde la raíz.
- PR abierto con todos los checks del CI en verde.

## Cierre

1. `orca worktree set --worktree active --workspace-status in-review --comment "<estado final>" --json`
2. Resumen corto: qué cambió, link del PR, y el estado real del CI. Si quedó rojo o si nunca abriste
   el PR, decilo así, sin maquillarlo — un PR que no verifica es peor que no tenerlo.

## Reglas

- No amplíes el alcance. Si encontrás otro problema, anotalo en el comentario del worktree y seguí.
- Actualizá el comentario del worktree en cada hito:
  `orca worktree set --worktree active --comment "<estado>" --json`.
- Las dependencias ya están instaladas por el hook de setup del repo. Si algo falla con
  `Cannot find module` para una dependencia que sí está en `package.json`, es el short-circuit de
  `pnpm install` en worktrees nuevos, no un bug del código:
  `rm -rf node_modules/.modules.yaml && pnpm install --frozen-lockfile`.
- Si quedás genuinamente bloqueado, dejá el bloqueo en el comentario del worktree y frená; no
  esperes respuesta.
