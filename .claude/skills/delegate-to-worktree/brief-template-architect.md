# Brief template — architect mode

For work with real implementation freedom: a feature, a behavior change, a bug whose cause is not
located yet. If the Scope already spells out the diff, use `brief-template-direct.md` instead.

Copy this into `<scratchpad>/brief-<slug>.md`, fill every section, delete nothing. Replace the
guidance in each section with real content — an empty or hand-waved section is where the delegated
agent goes off the rails.

The architect decomposes this brief into stage briefs its implementers never see the original of, so
whatever you leave vague it decides alone, with confidence, and every stage inherits that decision.

---

# <Task title>

Sos el agente responsable de esta tarea en este worktree. **No la implementes a mano.** Tu trabajo es
actuar como arquitecto: descomponer, despachar implementadores y revisar cada diff. Trabajás sin
supervisión: no preguntes, decidí y avanzá.

## Ejecución

Leé `.claude/skills/implement-with-architect/SKILL.md` y seguilo al pie de la letra: ese archivo es
tu contrato de trabajo. Tomá la **Tarea**, el **Alcance** y el **Fuera de alcance** de abajo como el
brief de entrada.

Dos cosas lo pisan, porque acá no hay nadie a quien preguntarle:

- Donde el skill dice que podés frenar y preguntar, **no frenes**: decidí la opción más conservadora,
  anotala en el decision log con el porqué, y seguí.
- Si el hueco es tan grande que cualquier decisión invalida la tarea, dejá el bloqueo en el
  comentario del worktree y frená ahí; no esperes respuesta.

**No corras la skill `pr` vos** — el cierre del skill despacha un subagente que la corre y espera el
CI.

## Tarea

<One imperative sentence: what must be true when you are done.>

## Contexto

<Why this task exists: the incident, the review finding, the user request. Include issue/PR numbers,
Sentry short-ids, links. Name the files and symbols already located — full repo-relative paths.
Reference artifacts (specs, diffs, logs) by path or URL; do not paste them.>

## Alcance

Incluye:

- <concrete change 1>
- <concrete change 2>

Fuera de alcance (decidido, no lo revisites):

- <thing deliberately left out, and why in half a line>

## Estado actual del worktree

<Branch and base commit. Anything already staged or applied here. If nothing: "Worktree limpio,
basado en origin/main.">

## Criterios de aceptación

- <observable outcome, not an implementation step>
- <...>

## Cierre

Reportá cómo terminó, sin maquillarlo:

| Desenlace | Qué reportar |
|---|---|
| PR abierto y CI en verde | Link del PR |
| PR abierto, CI rojo | Link del PR, qué check falla y por qué no lo pudiste arreglar |
| Sin PR | En qué etapa frenaste, qué quedó commiteado y qué falta |

Frenar sin PR no es un error del harness: es negarse a abrir un PR sobre trabajo que no verifica.
Presentalo así.

Después:

1. `orca worktree set --worktree active --workspace-status in-review --comment "<estado final>" --json`
2. Resumen corto: qué cambió, las etapas que aceptaste, el decision log, y el link del PR si hay.

## Reglas

- Cada etapa aceptada se commitea antes de empezar la siguiente. Si te caés a mitad, el trabajo
  aceptado ya está en la rama: retomá desde el último commit, no reempieces de cero.
- Todo subagente lleva `model` explícito, siempre. Omitirlo hereda el modelo de la sesión.
- Las dependencias ya están instaladas por el hook de setup del repo. Si algo falla con
  `Cannot find module` para una dependencia que sí está en `package.json`, es el short-circuit de
  `pnpm install` en worktrees nuevos, no un bug del código:
  `rm -rf node_modules/.modules.yaml && pnpm install --frozen-lockfile`.
- No amplíes el alcance. Si encontrás otro problema, anotalo en el comentario del worktree y seguí.
- Actualizá el comentario del worktree en cada hito:
  `orca worktree set --worktree active --comment "<estado>" --json`.
