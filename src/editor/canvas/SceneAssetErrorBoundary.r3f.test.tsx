import { act, create } from "@react-three/test-renderer";
import { Suspense, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SceneAssetErrorBoundary } from "./SceneAssetErrorBoundary";

type AssetPhase = "pending" | "rejected" | "ready";

let assetPhase: AssetPhase = "pending";
let resolveAsset: (() => void) | undefined;
let assetPromise: Promise<void>;

function preparePendingAsset() {
  assetPhase = "pending";
  assetPromise = new Promise<void>((resolve) => {
    resolveAsset = resolve;
  });
}

function AsyncImportedAsset() {
  if (assetPhase === "pending") throw assetPromise;
  if (assetPhase === "rejected") throw new Error("测试模型加载失败");

  return <mesh name="imported-asset" />;
}

function SceneFixture({ resetKey, children }: { resetKey: string; children?: ReactNode }) {
  return (
    <group name="scene-root">
      <mesh name="sibling-mesh" />
      <SceneAssetErrorBoundary fileName="broken.fbx" resetKey={resetKey}>
        <Suspense fallback={null}>{children ?? <AsyncImportedAsset />}</Suspense>
      </SceneAssetErrorBoundary>
    </group>
  );
}

function suppressExpectedError(event: ErrorEvent) {
  if (event.error instanceof Error && event.error.message === "测试模型加载失败") event.preventDefault();
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  window.addEventListener("error", suppressExpectedError);
  preparePendingAsset();
});

afterEach(() => {
  resolveAsset?.();
  resolveAsset = undefined;
  window.removeEventListener("error", suppressExpectedError);
  vi.restoreAllMocks();
});

it("isolates a suspended-then-rejected asset in the real R3F scene and resets by key", async () => {
  const renderer = await create(<SceneFixture resetKey="broken:1" />);

  expect(renderer.scene.findAllByProps({ name: "sibling-mesh" })).toHaveLength(1);
  expect(renderer.scene.findAllByProps({ name: "scene-asset-error-placeholder" })).toHaveLength(0);

  await act(async () => {
    assetPhase = "rejected";
    resolveAsset?.();
  });

  expect(renderer.scene.findAllByProps({ name: "scene-asset-error-placeholder" })).toHaveLength(1);
  expect(renderer.scene.findAllByProps({ name: "sibling-mesh" })).toHaveLength(1);
  expect(renderer.scene.findAllByProps({ name: "imported-asset" })).toHaveLength(0);

  await act(async () => {
    assetPhase = "ready";
    await renderer.update(<SceneFixture resetKey="recovered:2" />);
  });

  expect(renderer.scene.findAllByProps({ name: "scene-asset-error-placeholder" })).toHaveLength(0);
  expect(renderer.scene.findAllByProps({ name: "sibling-mesh" })).toHaveLength(1);
  expect(renderer.scene.findAllByProps({ name: "imported-asset" })).toHaveLength(1);

  await renderer.unmount();
});
