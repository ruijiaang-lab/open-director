# Project Data And Media IO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make imported panoramas, project JSON, and camera-path video durable, validated, and browser-correct.

**Architecture:** Convert file inputs into durable data before store mutation, validate serialized projects at the I/O boundary, mount the existing project controls in the scene panel, and isolate browser format negotiation in pure helpers.

**Tech Stack:** TypeScript, React, Zustand, MediaRecorder, Vitest, Testing Library

---

### Task 1: Durable panorama replacement

**Files:**
- Modify: `src/editor/loaders/panoramaImport.ts`
- Modify: `src/editor/store/directorStore.ts`
- Test: `src/editor/loaders/panoramaImport.projection.test.ts`
- Test: `src/editor/store/directorStore.test.ts`

- [ ] Add failing tests that an exact 2:1 input returns a `data:` URL and adding a second panorama removes the first panorama asset.
- [ ] Run both focused files and confirm failure.
- [ ] Add `readFileAsDataUrl(file)` using `FileReader` and use it for exact-ratio images.
- [ ] In `addImportedAsset`, replace the asset whose ID equals `panoramaAssetId` before appending the new one; keep non-panorama assets unchanged.
- [ ] Run focused tests and confirm pass.

### Task 2: Validated project import and accessible controls

**Files:**
- Create: `src/editor/io/projectValidation.ts`
- Modify: `src/editor/io/importProjectJson.ts`
- Modify: `src/editor/panels/CapturePanel.tsx`
- Modify: `src/editor/panels/ScenePanel.tsx`
- Test: `src/editor/io/importProjectJson.test.ts`
- Test: `src/editor/panels/CapturePanel.test.tsx`
- Test: `src/editor/panels/ScenePanel.test.tsx`

- [ ] Add failing tests for malformed JSON, wrong version, non-finite transform values, duplicate IDs, broken active camera/asset references, visible import errors, and a mounted “工程” section.
- [ ] Run the three focused files and confirm failure.
- [ ] Implement `validateDirectorProject(value: unknown): DirectorProject` with path-aware assertions. The entrypoint must remain:

```ts
export function parseProject(json: string): DirectorProject {
  let value: unknown;
  try { value = JSON.parse(json); }
  catch { throw new Error("工程 JSON 格式错误"); }
  return validateDirectorProject(value);
}
```

- [ ] Change export to an `<a download>` click followed by `URL.revokeObjectURL`; catch import errors, display them, and clear the file input.
- [ ] Mount `<CapturePanel />` inside the scene inspector after scene controls.
- [ ] Run focused tests and confirm pass.

### Task 3: Browser-correct video format negotiation

**Files:**
- Modify: `src/editor/io/videoExport.ts`
- Create: `src/editor/io/videoExport.test.ts`

- [ ] Add failing tests for MP4 preference when supported, WebM fallback, and extension selection from `recorder.mimeType` or Blob type.
- [ ] Run `npm test -- src/editor/io/videoExport.test.ts` and confirm failure.
- [ ] Extract pure helpers `selectRecorderMimeType` and `getVideoExtension`; candidates include `video/mp4;codecs=h264`, `video/mp4`, VP9, VP8, and WebM.
- [ ] Build the final Blob with the effective recorder/chunk type and use that same type to choose `.mp4` or `.webm`.
- [ ] Run the focused test and confirm pass.
- [ ] Run `npm test -- src/editor/io src/editor/loaders src/editor/panels` as the subsystem gate.
