# Yuvilab Spark Unity Learning World

This Unity 6 project is the visual renderer for the 720 Feature 1 learning world.
It does not determine curriculum order, completion, mastery, or bridge availability.
React sends a projection built from provider order and Brain/xAPI-backed progress.

## Ownership boundary

- **React/FastAPI:** catalog loading, Brain/xAPI truth, localization, accessible task list,
  Coach, lesson routing, details, static fallback, and learner announcements.
- **Unity:** continuous terrain, buildings, bridges, projected movement, authored static
  section cameras, particles, and pointer/keyboard world interaction.
- **Browser bridge:** only pseudonymous curriculum IDs and non-identifying avatar
  presentation settings cross the boundary. No learner PII is sent to Unity.

## Build

Install Unity `6000.0.79f1` with Web Build Support and activate a Unity license, then run
`npm run build:unity` from `frontend/` or `scripts/build-unity-world.sh` from the repository root.
The generated build is written to `frontend/public/unity-world/` and Vite copies it into
`static/react/unity-world/` for FastAPI deployment.

Run `npm run build:all` to rebuild Unity and the React application together.

## Runtime contract

React calls the `LearningWorld` GameObject methods `Configure`, `Focus`, `SetSelected`,
`TravelTo`, `ShowBlocked`, `ResetCamera`, and `SetPaused`. Unity emits the
`yuvi-unity-world` browser event with `ready`, `landmark-select`, `blocked`,
`bridge-blocked`, `yubi-interact`, `avatar-projection`, `travel-complete`, `stats`,
or `error`.

Bridge state remains backend-derived: a bridge opens only when the preceding unit is
complete or the backend already exposes reachable content on the next unit.
