# Timeline And Playback Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent stale playback and cross-camera timeline edits while preserving current camera-path behavior.

**Architecture:** Fix undefined checks at the store boundary, validate selection ownership in the timeline, and centralize invalid-path stop behavior in the playback controller.

**Tech Stack:** React, Zustand, React Three Fiber, TypeScript, Vitest, Testing Library

---

### Task 1: Zero hold and duration patch semantics

**Files:**
- Modify: `src/editor/store/directorStore.ts`
- Test: `src/editor/store/directorStore.test.ts`

- [ ] Add a failing test that changes a segment hold from a positive value to `0` and preserves duration when it is omitted.
- [ ] Run the focused test and confirm failure.
- [ ] Replace truthy checks with `patch.holdAfter !== undefined` and `patch.duration !== undefined`.
- [ ] Run the focused test and confirm pass.

### Task 2: Camera-owned timeline selection

**Files:**
- Modify: `src/editor/timeline/DirectorTimeline.tsx`
- Create: `src/editor/timeline/DirectorTimeline.test.tsx`

- [ ] Add failing tests where two cameras reuse a node/segment ID; switching the active camera must not expose or mutate the old selection.
- [ ] Run the focused test and confirm failure.
- [ ] Gate selected node, segment and handle by `selection.cameraId === camera.id` and add an effect on `camera?.id` that pauses, resets playhead, and clears selection.
- [ ] Run the focused test and confirm pass.

### Task 3: Stop invalid playback

**Files:**
- Modify: `src/editor/canvas/CameraPlaybackController.tsx`
- Create: `src/editor/canvas/CameraPlaybackController.test.tsx`

- [ ] Add failing frame-loop tests for a missing active camera, zero/one node, and a path removed during playback.
- [ ] Run the focused test and confirm failure.
- [ ] Before advancing time, pause when the active camera has fewer than two nodes or total duration is non-finite/non-positive.
- [ ] Run the focused test and confirm pass.
- [ ] Run `npm test -- src/editor/store src/editor/timeline src/editor/canvas/CameraPlaybackController.test.tsx` as the subsystem gate.
