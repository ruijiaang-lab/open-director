# Quality And Integration Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cleanup, code quality, CI, documentation, and final browser behavior reproducible.

**Architecture:** Keep runtime changes small, add a modern flat ESLint configuration, run the same three gates locally and in GitHub Actions, and document behavior instead of brittle test counts.

**Tech Stack:** React, TypeScript, ESLint 9, Vitest, Vite, GitHub Actions

---

### Task 1: Host bridge cleanup

**Files:**
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`

- [ ] Add a failing test that unmounts `App` and expects `clearDirectorDeskHostBridge` exactly once.
- [ ] Run the focused test and confirm failure.
- [ ] Return the cleanup function from the host bridge effect:

```ts
useEffect(() => {
  initDirectorDeskHostBridge();
  window.parent?.postMessage({ type: "storyai:director-desk-ready" }, window.location.origin);
  return clearDirectorDeskHostBridge;
}, []);
```

- [ ] Run the focused test and confirm pass.

### Task 2: Lint and CI gates

**Files:**
- Create: `eslint.config.js`
- Create: `.github/workflows/ci.yml`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Add ESLint, TypeScript ESLint, React Hooks and React Refresh dev dependencies with `npm install --save-dev eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh`.
- [ ] Add `"lint": "eslint ."` and a flat config that ignores `dist`, enables TypeScript recommended rules, and applies React Hooks rules to TSX.
- [ ] Run `npm run lint`, fix real findings without suppressing project-wide correctness rules, and confirm exit 0.
- [ ] Add CI steps `npm ci`, `npm run lint`, `npm test -- --reporter=dot`, and `npm run build` on macOS-compatible Node 22 Ubuntu runners.
- [ ] Inspect the lockfile diff and run `npm audit`; do not commit.

### Task 3: Documentation and final verification

**Files:**
- Modify: `README.md`

- [ ] Update project import/export, browser video format, AI confirmation, and local model failure behavior. Remove exact historical test counts.
- [ ] Run `npm run lint` and require exit 0.
- [ ] Run `npm test -- --reporter=dot` and require all test files/cases pass.
- [ ] Run `npm run build` and require exit 0.
- [ ] Start the local app and verify AI/settings clicks do not request Pointer Lock, dangerous AI commands wait for confirmation, project import errors are visible, panorama replacement persists across reload, bad models do not crash the canvas, and cross-camera timeline selection does not mutate another camera.
- [ ] Inspect `git status --short` and separate newly completed files from pre-existing user changes in the handoff; do not commit or push.
