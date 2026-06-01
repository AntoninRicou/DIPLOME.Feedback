# Project Architecture

A vanilla JavaScript app (no React/Vue) bundled with **Vite**, rendering 2D points in a 3D scene via **Three.js**, and driven remotely through **socket.io**.

The page is divided into 4 panels (`container-1` … `container-4`), each running its own independent Three.js scene that visualizes the same dataset under a different 2D projection (UMAP variants, raw 2D projection, …).

---

## High-level data flow

```
              ┌────────────────────────┐
              │      socket.io         │  ◄── remote commands
              │      server (3001)     │
              └───────────┬────────────┘
                          │ messages
                          ▼
[api.js] ──► [commandsManager.js] ──► [commands.js] ──► acts on apps + stateManager
                                                              │
                                                              ▼
                                            ┌──── apps[] (one per panel) ────┐
                                            │                                │
                                            ▼                                ▼
                                       [app.js]                         [app.js]
                                        scene/camera/renderer            ...
                                            │
                                            ▼
                                  [components/pointsManager.js]
                                   (InstancedMesh of thumbnails)
                                            │
                                            ▼
                                       [mapData.js]
                                   (loads JSON projections)
```

`main.js` is the orchestrator: it creates the 4 apps, wires the socket bridge, and runs the global animation loop.

---

## File-by-file

### Entry point

**[index.html](index.html)**
Loads `/src/main.js` as a module and defines the four panel `<div>`s (`container-1` … `container-4`).

**[vite.config.js](vite.config.js)**
Vite config. Adds two dev-server middlewares that expose folders outside the project as URLs:
- `/datas/*` → `./datas/` (the JSON projections)
- `/atlas/*` → `../process/cache/` (the image atlas + metadata produced by an external Python pipeline)

**[src/main.js](src/main.js)**
The boot script. Responsibilities:
1. Creates a `stateManager` (layout/state machine).
2. Calls `createApp()` four times, each with a different `mapType` (`trace`, `mirror`, `shift`, `replay`).
3. Connects to the socket server, builds `commands` + `commandsManager`, and registers all message handlers.
4. Exposes a debugging API on `window.api` (so you can type `api.run('focus-random')` in the browser console).
5. Runs the global `requestAnimationFrame` loop, which advances the state manager and ticks every ready app each frame.

---

### Per-panel scene

**[src/app.js](src/app.js)**
A factory that creates **one Three.js scene** inside a panel. Returns an object with methods that `main.js` and `commands.js` call:
- `animate(dt)` – renders one frame and lerps the camera toward a drift target.
- `focusOn(pointId)` – moves the camera over a given point and highlights it.
- `morphTo(targetMapType, duration)` – animates point positions to those of another projection (used by the `single` state cycle).
- `enterDisperse(opts)` / `exitDisperse()` – triggers the burst+drift animation.
- `setCameraZ(z)`, `setDriftTarget(x, y)`, `resize()`, `getIds()` – misc.

During `setup()` it loads three things in parallel: the JSON projection (`mapData.js`), the atlas metadata (`/atlas/atlas.json`), and the atlas texture (`/atlas/atlas.jpg`). Then it hands them to `createPointsManager`.

**[src/components/pointsManager.js](src/components/pointsManager.js)**
The heart of the rendering. For one panel it:
- Builds a single Three.js **`InstancedMesh`** with `N` instances (one per point), all sharing a unit `PlaneGeometry`.
- Uses a custom **shader** so each instance samples a different sub-rectangle of the atlas texture (the per-instance UV rectangle is passed via the `aUvRect` instanced attribute).
- Stores `positions[i]`, `ids[i]`, and an `idToIndex` map so points can be looked up by their stable ID.
- Implements three animations driven by `tick(dt)`:
  - **morph** (`morphTo`) – eased interpolation between two sets of XY positions.
  - **disperse burst** – every point flies out from the origin to a random spawn point.
  - **disperse drift** – after the burst, every point wanders around its spawn anchor using two summed sinusoids per axis.
- `highlight(id)` – scales one instance up and pulls it forward in Z.

**[src/components/gridManager.js](src/components/gridManager.js)** & **[src/components/point.js](src/components/point.js)**
Currently unused stubs (gridManager logs a string; point.js is empty).

**[src/mapData.js](src/mapData.js)**
A small loader. Maps a `mapType` string to a JSON URL under `/data/...` and `fetch`es it. Returns `{ points: [{ id, x, y }, ...] }`. (The URL prefix is `/data/` because the actual JSONs live in `static/data/` — Vite serves `static/` as the public dir.)

---

### Layout / state machine

**[src/stateManager.js](src/stateManager.js)**
Owns the **layout state** for the whole page (independent from per-app rendering). Four named states:
- `split` – all four containers in a 2×2 grid, camera close (`z = 0.2`).
- `single` – container-1 fills the screen, the other three collapse to zero size; cycles through map types using `morphTo` every ~5 s.
- `overview` – same 2×2 layout but with the camera pulled back (`z = 3.5`) so each panel shows the full cloud.
- `disperse` – fullscreen, triggers `enterDisperse` on the first app.

`goTo(name, { duration })` starts an eased transition (`easeInOutCubic`) between the current state and the target. Each frame `tick(dt)`:
1. Advances any in-progress transition (lerps container rects + cameraZ, applies them via CSS `%`).
2. Pushes the new cameraZ to every app.
3. Optionally drives camera drift and the `single` map-cycle.

---

### Remote control layer

**[src/api.js](src/api.js)**
Thin socket.io wrapper. Connects to `VITE_SOCKET_URL` (defaults to `http://localhost:3001`), registers as role `'project'`, exposes:
- `connect()` – open the connection.
- `on(type, callback)` – subscribe to a message type. Multiple listeners per type are supported (kept in a `Map<type, Set<callback>>`).
- `send(type, payload)` – emit a message back to the server.

**[src/commandsManager.js](src/commandsManager.js)**
Maps **message types → handler functions**:
- `focus`        → focuses on `payload.id`
- `focus-random` → picks a random ID common to all ready apps and focuses on it
- `set-state`    → tells `stateManager` to go to `payload.name`

Exposes `register(on)` (binds every handler to the socket via `api.on`), `run(type, payload)` (call a handler directly — used by `window.api.run`), and `list()`.

**[src/commands.js](src/commands.js)**
The **actual implementations** the commandsManager calls. Split from commandsManager so the routing (which message → which function) is separate from the side-effects (what those functions do). The commandsManager only does dispatch; commands.js touches the apps and the state manager.

---

### Styling

**[src/style.css](src/style.css)** – global CSS for `.container` panels (positioning, background, etc.).

---

## How it all connects (one example)

You send `{"type":"set-state","payload":{"name":"single","duration":1.5}}` from the socket server.

1. `api.js` receives the `message` event and looks up listeners for type `set-state`.
2. The matching handler (registered by `commandsManager.register`) calls `actions.setState(payload)` from `commands.js`.
3. `commands.js` calls `stateManager.goTo('single', { duration: 1.5 })`.
4. `stateManager` starts a transition. On every frame:
   - It lerps the four container rectangles → only container-1 grows to fullscreen, the others shrink.
   - It pushes `cameraZ = 3.5` to all four `app.js` instances.
5. After the transition completes, the `single`-cycle timer kicks in and periodically calls `app1.morphTo(randomMapType, 1)`, which makes `pointsManager` animate every point to the new projection's XY coordinates.
6. Meanwhile `main.js`'s `requestAnimationFrame` loop keeps calling `stateManager.tick(dt)` and `app.animate(dt)` so the morph plays smoothly.

---

## External assets the app expects at runtime

| URL | Served from | Contents |
|---|---|---|
| `/data/*.json` | `static/data/` (via Vite's `publicDir`) | The point coordinates per projection |
| `/atlas/atlas.json` | `../process/cache/` (via `vite.config.js` middleware) | Per-image atlas metadata: `images[id] = { imgU, imgV, imgUSize, imgVSize, aspect }` |
| `/atlas/atlas.jpg` | same | The packed thumbnail atlas texture |

If `../process/cache/` is missing, `app.js` will fail on the atlas fetches.
