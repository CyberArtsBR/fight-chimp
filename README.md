# Canopy Clash — Chimpions 3D Fight

A playable side-view 3D fighting game prototype built with React, TypeScript, Vite and Three.js.

## Gameplay

- Player vs CPU
- Best-of-three rounds
- Punch, kick and guard
- Side movement and spacing
- Active attack windows and range checks
- Blocking damage reduction
- Knockback, hit reactions and KO poses
- Treehouse arena with forest depth, railings, hut and lantern lighting
- Desktop keyboard controls and mobile touch controls
- Fullscreen support

## Controls

- `A` / `D` or Left / Right — move
- `J` — punch
- `K` — kick
- `L` — guard
- `Space` / `Enter` — start / rematch

## Custom Chimpion GLBs

The game is already wired to load:

```text
public/models/fighter-1.glb
public/models/fighter-2.glb
```

If either GLB is missing, the arena stays playable with procedural fallback fighters. Once the real files are added under those exact names, they replace the fallbacks automatically.

Original avatar source links supplied for this project:

- https://drive.google.com/file/d/18YdEX7NPGljrh42ReQTozH86GI2hk9SQ/view?usp=drive_link
- https://drive.google.com/file/d/1TnullbZPmvmryGPs95IkBaRdm6hE8oqe/view?usp=drive_link

Google Drive is intentionally not used as the runtime asset host because browser CORS/download behavior is unreliable for GLB loading.

## Run locally

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

## CI / deployment

- `.github/workflows/ci.yml` validates the production build.
- `.github/workflows/pages.yml` builds and deploys `dist/` through GitHub Pages when Pages is enabled for the repository.

## Model rig support

The loader recognizes common humanoid bone names for head, chest, upper arms, forearms, thighs and calves. The game then drives those bones procedurally for walking, punching, kicking, guarding and hit reactions. Models with unusual custom bone names can still load visually but may need a small rig-name mapping pass for best animation quality.
