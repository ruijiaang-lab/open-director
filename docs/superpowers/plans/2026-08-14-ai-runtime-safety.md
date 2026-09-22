# AI And Runtime Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI commands and 3D file interactions fail closed without breaking the editor canvas.

**Architecture:** Keep the existing command switch and UI composition. Add narrow validation helpers, a destructive-command confirmation state, a canvas-only Pointer Lock selector, per-import error isolation, and a viewport status surface.

**Tech Stack:** React 18, TypeScript, Zustand, React Three Fiber, Drei, Vitest, Testing Library

---

### Task 1: Command target and argument validation

**Files:**
- Modify: `src/editor/agent/directorCommands.ts`
- Test: `src/editor/agent/directorCommands.test.ts`

- [ ] Add failing tests proving an empty or partial name cannot move/delete the first object, non-finite vectors are rejected, non-characters reject `set_pose`, and normalized playhead output is reported.
- [ ] Run `npm test -- src/editor/agent/directorCommands.test.ts` and confirm the new cases fail against the current implementation.
- [ ] Replace substring lookup with required exact lookup and add finite-number/range helpers. The lookup contract is:

```ts
function requireObjectByName(value: unknown) {
  const name = asRequiredString(value, "缺少对象名称");
  const object = useDirectorStore.getState().project.objects.find((item) => item.name === name);
  if (!object) throw new Error(`找不到对象「${name}」，请使用场景中的完整名称`);
  return object;
}
```

- [ ] Run the focused test and confirm all cases pass.
- [ ] Inspect `git diff` as a local checkpoint; do not commit.

### Task 2: Destructive AI confirmation

**Files:**
- Modify: `src/editor/agent/DirectorAssistantPanel.tsx`
- Modify: `src/editor/agent/directorCommands.ts`
- Test: `src/editor/agent/DirectorAssistantPanel.test.tsx`

- [ ] Add failing tests that `delete_object` and `clear_scene` produce a confirmation card, cancellation makes no store mutation, and confirmation executes exactly once.
- [ ] Run `npm test -- src/editor/agent/DirectorAssistantPanel.test.tsx` and observe failure.
- [ ] Export `isDestructiveDirectorCommand` and store pending commands in panel state:

```ts
const [pendingCommands, setPendingCommands] = useState<DirectorCommand[] | null>(null);
const needsConfirmation = commands.some(isDestructiveDirectorCommand);
```

- [ ] Render “确认执行” and “取消” controls only while a batch is pending; disable sending until resolved.
- [ ] Correct the API Key hint to state that the key is stored locally and sent to the configured service during requests.
- [ ] Run focused tests and confirm pass.

### Task 3: Canvas-only Pointer Lock

**Files:**
- Modify: `src/editor/controls/CameraFPSControls.tsx`
- Test: `src/editor/canvas/CameraFPSMode.test.tsx`

- [ ] Add a failing mock assertion for `selector='[data-testid="director-canvas"] canvas'`.
- [ ] Run `npm test -- src/editor/canvas/CameraFPSMode.test.tsx` and confirm failure.
- [ ] Pass the explicit selector to `PointerLockControls` without changing movement behavior.
- [ ] Run the focused test and confirm pass.

### Task 4: Imported model error isolation and toolbar recovery

**Files:**
- Create: `src/editor/canvas/SceneAssetErrorBoundary.tsx`
- Modify: `src/editor/canvas/SceneRoot.tsx`
- Modify: `src/editor/canvas/ViewportToolbar.tsx`
- Modify: `src/styles/index.css`
- Test: `src/editor/canvas/SceneRoot.test.tsx`
- Test: `src/editor/canvas/ViewportToolbar.test.tsx`

- [ ] Add failing tests for a throwing imported model, visible import error text, and capture failure restoring the previous project/view.
- [ ] Run both focused test files and confirm the cases fail.
- [ ] Implement a class error boundary whose Three fallback is a red wireframe box and whose reset key is the asset URL.
- [ ] Add a small viewport status state with `role="status"`; in capture handling snapshot project/view before mutation and restore on error.
- [ ] Run both focused tests and confirm pass.
- [ ] Run `npm test -- src/editor/agent src/editor/controls src/editor/canvas` as the subsystem gate.
