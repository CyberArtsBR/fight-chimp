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

Both supplied Chimpion files were inspected in CI and use the same Mixamo-style humanoid skeleton:

- **Fighter 1:** 28 nodes, 1 skin, 25 joints, no embedded animation clips.
- **Fighter 2:** 28 nodes, 1 skin, 25 joints, 1 embedded Mixamo clip (`Armature|mixamo.com|Layer0`).
- Key joints include `Hips`, `Spine`, `Spine1`, `Spine2`, `Neck`, `Head`, left/right shoulders, arms, forearms, hands, thighs, calves, feet and toes.

The runtime matcher now understands Mixamo prefixes plus common Blender/custom naming variants. Combat poses explicitly use hips, spine, chest, neck, shoulders, upper/lower arms and upper/lower legs, while retaining procedural fallback fighters if a GLB cannot load.

## Current combat polish

- Rig-specific procedural idle, walk, punch, kick, guard, hit and KO posing
- Hit-stop on clean attacks and shorter block-stop on guarded attacks
- Dynamic side-view camera framing based on fighter distance
- Impact camera punch and shake
- Automatic transition between rounds
- Runtime rig-match diagnostics in the browser console
- CI-side GLB validation and skeleton inspection
