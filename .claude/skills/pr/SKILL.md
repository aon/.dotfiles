---
name: pr
description: >-
  Abrir el pull request de la rama actual y quedarse hasta que el CI esté en verde. Escribe el
  cuerpo en español siguiendo el template del repo, breve y sin lenguaje de IA, después espera los
  checks y arregla lo que rompa. Usar cuando el usuario dice "creá el PR", "abrí el PR", "abrime
  un PR", "subilo", "open the PR", o cuando un agente delegado llega al cierre de su tarea. El
  automerge NO es el default: solo se activa si lo piden explícitamente.
---

# PR

Abrís el PR, lo dejás en verde, y recién ahí terminás.

## 1. Antes de empezar

- Todo commiteado y pusheado (`git status --porcelain` vacío, rama con upstream).
- No estás en `main`.
- Si el usuario pidió automerge, anotalo: cambia el paso 5.

## 2. Escribir el cuerpo

Leé `.github/pull_request_template.md` del repo y seguí sus secciones. No lo copies acá: si el
template cambia, esta skill no se entera.

**Breve. En serio breve.** El objetivo es que se lea en 30 segundos:

- *Problema*: 1 a 3 líneas.
- *Solución*: 2 a 5 líneas o bullets.
- *Testing*: los comandos que corriste, con su resultado.
- Todo junto, menos de 15 líneas.

**La regla que decide qué entra:** cada línea trae un dato que el reviewer **no** puede sacar del
diff. Números, fechas, ids, el error exacto, la alternativa que descartaste y por qué. Si una línea
describe lo que el diff ya muestra, borrala.

**Prohibido** — esto es lo que hace que un PR huela a IA:

| No | Por qué |
|---|---|
| "Este PR introduce / agrega / implementa…" | Arranque de plantilla. Empezá por el hecho. |
| Enumerar los archivos tocados | Está en el diff. |
| Parafrasear el diff en prosa | Idem. |
| "Además", "Asimismo", "Cabe destacar", "Es importante notar" | Relleno conector. |
| Emojis de sección, negritas decorativas | Ruido. |
| "de forma robusta / elegante / limpia" | Autoelogio sin dato. |
| Un párrafo final que resume lo que acabás de decir | Ya lo dijiste. |

Escribí como si se lo contaras a un colega que conoce el código: directo, en primera persona
cuando corresponde, sin ceremonia.

**Ejemplo del tono** (de este repo, PR de un fix de config):

```markdown
**Problema:**

Los tests de `@afippi/core` fallaban con `Cannot find package '@afippi/core/utils/...'` sobre
archivos que sí están en el código fuente. `pnpm check` pasaba y CI también.

**Solución:**

Los tests de core lo importan por nombre de paquete y el `exports` map resuelve a `dist/`. La task
`test` declaraba solo `^build`, que compila las dependencias y nunca a core, así que corría contra
un `dist` viejo. Agregué `packages/core/turbo.json` con `dependsOn: ["^build", "build"]`.

---

*Testing:*

Borré `packages/core/dist` y corrí `turbo test --filter=@afippi/core`: antes 24 archivos en rojo,
ahora buildea primero y pasan los 58. `pnpm test` completo en 9/9.
```

## 3. Crear el PR

```bash
gh pr create --title "<conventional commit>" --body-file <archivo>
```

Título con prefijo convencional, en español, igual que el commit principal.

## 4. Esperar el CI

No termines el turno con el PR sin resolver. Armá un **Monitor** (`persistent: true`, description
`checks del PR <n>`) que emita cada check apenas cierra y corte cuando no queda ninguno pendiente:

```bash
prev=""
while true; do
  s=$(gh pr checks <n> --json name,bucket 2>/dev/null || true)
  [ -n "$s" ] || { sleep 30; continue; }
  cur=$(jq -r '.[] | select(.bucket != "pending") | "\(.name): \(.bucket)"' <<<"$s" | sort)
  comm -13 <(echo "$prev") <(echo "$cur")
  prev=$cur
  jq -e 'all(.bucket != "pending")' <<<"$s" >/dev/null && break
  sleep 30
done
```

El `|| true` no es cosmético: `gh pr checks` sale con código distinto de cero cuando hay checks
pendientes o rojos, así que sin eso perdés la salida buena.

Cada check llega como notificación con su bucket (`pass`, `fail`, `skipping`, `cancel`) — arrancá a
arreglar el primero que se pone rojo sin esperar a que terminen los demás. Seguí trabajando mientras
tanto; las notificaciones te encuentran.

Nunca esperes el CI en primer plano: el CI de este repo tarda más que el tope de una llamada de
shell y te la come el timeout.

## 5. Si el CI falla

1. Leé el log del check que falló (`gh run view <run-id> --log-failed`).
2. Arreglalo, commiteá, pusheá, volvé al paso 4.
3. **Máximo 2 intentos.** Si al tercero sigue rojo: `gh pr ready --undo`, dejá la salida exacta del
   check que falla en un comentario del PR, y frená. No sigas intentando y no lo escondas.

Si el usuario pidió **automerge** y el PR quedó en verde:

```bash
gh pr merge <n> --auto --merge
```

Este repo solo permite merge commits — `--squash` y `--rebase` están deshabilitados. Sin pedido
explícito, no lo actives.

## 6. Cerrar

Un resumen corto: qué cambiaste, cómo se verificó, estado del CI, link del PR. Si quedó en draft
por rojo, decilo primero.
