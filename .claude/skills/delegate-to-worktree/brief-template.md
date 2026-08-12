# Brief template

Copy this into `<scratchpad>/brief-<slug>.md`, fill every section, delete nothing. Replace the
guidance in each section with real content — an empty or hand-waved section is where the delegated
agent goes off the rails.

The three fields the workflow reads are **Tarea**, **Alcance** and **Fuera de alcance**. The
workflow cannot ask anything once it starts, so whatever you leave vague it decides alone, with
confidence, for twenty minutes.

---

# <Task title>

Sos el agente responsable de esta tarea en este worktree. **No la implementes a mano.** Tu trabajo
es lanzar el workflow `implement` y reportar cómo terminó. Trabajás sin supervisión: no preguntes,
decidí y avanzá.

## Ejecución

Asegurá dependencias primero — los hooks de setup del repo pueden seguir corriendo:

```bash
pnpm install --frozen-lockfile
```

Después lanzá el workflow, copiando las tres secciones de abajo en sus args:

```js
Workflow({
  name: "implement",
  args: {
    task: "<Tarea, una oración imperativa>",
    scope: "<Alcance, con archivos y símbolos>",
    outOfScope: "<Fuera de alcance>"
  }
})
```

Corre en background y devuelve un `runId`. La notificación llega sola: no poleés. **No corras la
skill `pr` ni abras el PR vos** — el workflow implementa, verifica, revisa, corrige, abre el pull
request y espera el CI por su cuenta.

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

Reportá el `state` que devolvió el workflow, tal cual, sin maquillarlo:

| `state` | Qué pasó |
|---|---|
| `green` | PR abierto y CI en verde |
| `pr-in-draft` | CI rojo después de 2 intentos; quedó en draft a propósito |
| `failed-verifying` | El suite nunca se puso verde. **No se abrió PR**, y eso está bien |
| `failed-fixing` | Los arreglos de la revisión rompieron algo; la rama quedó a medias |
| `failed-implementing` | El primer agente murió; hay que mirar el journal |

Un `failed-*` no es un error del harness: es el pipeline negándose a abrir un PR sobre trabajo que
no verifica. Presentalo así.

Después:

1. `orca worktree set --worktree active --workspace-status in-review --comment "<estado final>" --json`
2. Resumen corto: qué cambió, `state`, `reviewDepth`, link del PR si hay.

## Reglas

- Si el workflow murió a mitad, no lo relances de cero: leé `<transcriptDir>/journal.jsonl` para ver
  en qué fase se cayó, y retomá con `Workflow({ scriptPath, resumeFromRunId })`.
- No amplíes el alcance. Si encontrás otro problema, anotalo en el comentario del worktree y seguí.
- Actualizá el comentario del worktree en cada hito:
  `orca worktree set --worktree active --comment "<estado>" --json`.
- Si quedás genuinamente bloqueado, dejá el bloqueo en el comentario del worktree y frená; no
  esperes respuesta.
