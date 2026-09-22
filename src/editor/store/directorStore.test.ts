import { afterEach, beforeEach, vi } from "vitest";
import { createDefaultDirectorProject, createInitialDirectorState, useDirectorStore } from "./directorStore";
import { selectRightPanelKind } from "./directorSelectors";
import { VIEWPORT_CAMERA_FRUSTUM_DEPTH, getCameraRigPositionFromViewSnapshot } from "../schema/cameraGeometry";
import { getDirectorObjectFocusTarget } from "../schema/cameraTarget";
import { MIN_SEGMENT_DURATION } from "../camera/cameraPath";
import type { DirectorAssetRef } from "../schema/directorProject";

function createMemoryStorage(): Storage {
  const storage = new Map<string, string>();

  return {
    get length() {
      return storage.size;
    },
    clear: () => storage.clear(),
    getItem: (key) => storage.get(key) ?? null,
    key: (index) => Array.from(storage.keys())[index] ?? null,
    removeItem: (key) => {
      storage.delete(key);
    },
    setItem: (key, value) => {
      storage.set(key, String(value));
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createMemoryStorage());
  useDirectorStore.getState().openScopedScene(null);
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    ...createInitialDirectorState(),
    clipboard: [],
    clipboardPasteCount: 0,
    undoStack: [],
    undoBatchDepth: 0,
    undoBatchSnapshot: null,
    undoBatchHasTrackedChanges: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("seeds the demo with one mannequin role and one camera", () => {
  const state = createInitialDirectorState();
  const defaultCharacter = state.project.objects.find((item) => item.kind === "character");
  const defaultCameraObject = state.project.objects.find((item) => item.kind === "camera");

  expect(state.viewMode).toBe("director");
  expect(state.viewportAspectRatio).toBe("auto");
  expect(state.viewportRuleOfThirdsEnabled).toBe(false);
  expect(state.project.scene.backgroundColor).toBe("#000000");
  expect(defaultCharacter?.name).toBe("角色01");
  expect(defaultCameraObject?.name).toBe("机位01");
  expect(state.project.cameras[0]?.name).toBe("机位01");
  expect(state.project.objects.some((item) => item.kind === "character")).toBe(true);
  expect(state.project.cameras).toHaveLength(1);
});

it("updates the viewport aspect ratio selection in ui state", () => {
  useDirectorStore.setState(createInitialDirectorState());

  useDirectorStore.getState().setViewportAspectRatio("9:16");

  expect(useDirectorStore.getState().viewportAspectRatio).toBe("9:16");
});

it("updates the viewport rule-of-thirds guide toggle in ui state", () => {
  useDirectorStore.setState(createInitialDirectorState());

  useDirectorStore.getState().setViewportRuleOfThirdsEnabled(true);

  expect(useDirectorStore.getState().viewportRuleOfThirdsEnabled).toBe(true);
});

it("toggles the viewport side panel collapse flag in ui state", () => {
  useDirectorStore.setState(createInitialDirectorState());

  type CollapseUiState = ReturnType<typeof useDirectorStore.getState> & {
    viewportPanelsCollapsed?: boolean;
    toggleViewportPanelsCollapsed?: () => void;
  };
  const state = useDirectorStore.getState() as CollapseUiState;

  expect(state.viewportPanelsCollapsed ?? false).toBe(false);

  state.toggleViewportPanelsCollapsed?.();

  expect((useDirectorStore.getState() as CollapseUiState).viewportPanelsCollapsed ?? false).toBe(true);
});

it("routes the right panel by object type and view mode", () => {
  const state = createInitialDirectorState();
  const characterId = state.project.objects.find((item) => item.kind === "character")!.id;
  const cameraObjectId = state.project.objects.find((item) => item.kind === "camera")!.id;
  const propState = {
    ...state,
    selectedObjectId: "prop_model_1",
    project: {
      ...state.project,
      objects: [
        ...state.project.objects,
        {
          id: "prop_model_1",
          name: "自动取款机",
          kind: "prop" as const,
          visible: true,
          locked: false,
          assetRefId: "asset_model_1",
          transform: {
            position: [0, 0, 0] as [number, number, number],
            rotation: [0, 0, 0] as [number, number, number],
            scale: [1, 1, 1] as [number, number, number],
          },
        },
      ],
      assets: [
        ...state.project.assets,
        {
          id: "asset_model_1",
          kind: "prop" as const,
          sourceType: "model" as const,
          fileName: "ATM_low.fbx",
          url: "blob:atm",
        },
      ],
    },
  };

  expect(selectRightPanelKind(state)).toBe("scene");
  expect(selectRightPanelKind({ ...state, selectedObjectId: characterId })).toBe("character");
  expect(selectRightPanelKind({ ...state, selectedObjectId: cameraObjectId })).toBe("camera");
  expect(selectRightPanelKind(propState)).toBe("prop");
  expect(selectRightPanelKind({ ...state, viewMode: "camera", selectedObjectId: null })).toBe("camera");
});

it("routes a selected crowd group to the role panel", () => {
  const state = createInitialDirectorState();

  expect(selectRightPanelKind({ ...state, selectedCrowdId: "crowd_1" })).toBe("character");
});

it("routes older model-backed scene objects to the model panel", () => {
  const state = createInitialDirectorState();

  expect(
    selectRightPanelKind({
      ...state,
      selectedObjectId: "obj_scene_model_1",
      project: {
        ...state.project,
        assets: [
          {
            id: "asset_scene_model_1",
            kind: "scene",
            sourceType: "model",
            fileName: "microwave_low.fbx",
            url: "blob:microwave",
          },
        ],
        objects: [
          ...state.project.objects,
          {
            id: "obj_scene_model_1",
            name: "微波炉",
            kind: "scene",
            visible: true,
            locked: false,
            assetRefId: "asset_scene_model_1",
            transform: {
              position: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
            },
          },
        ],
      },
    })
  ).toBe("prop");
});

it("defaults generated characters to the male mannequin body type", () => {
  const project = createDefaultDirectorProject();
  const character = project.objects.find((item) => item.kind === "character");

  expect(character?.bodyType).toBe("mannequin");
});

it("adds preset characters with a requested body type", () => {
  useDirectorStore.setState(createInitialDirectorState());

  useDirectorStore.getState().addPresetCharacter("female");

  const characters = useDirectorStore.getState().project.objects.filter((item) => item.kind === "character");
  const added = characters[characters.length - 1];

  expect(added?.bodyType).toBe("female");
  expect(added?.name).toBe("角色02");
  expect(added?.characterRig?.rigType).toBe("ue4-mannequin");
  expect(useDirectorStore.getState().selectedObjectId).toBe(added?.id);
});

it("adds camera shots with two-digit camera names", () => {
  useDirectorStore.setState(createInitialDirectorState());

  useDirectorStore.getState().addCameraShot();

  const state = useDirectorStore.getState();

  expect(state.project.cameras.map((camera) => camera.name)).toEqual(["机位01", "机位02"]);
  expect(state.project.objects.filter((item) => item.kind === "camera").map((item) => item.name)).toEqual([
    "机位01",
    "机位02",
  ]);
});

it("keeps the default character blue and gives newly added characters distinct colors", () => {
  useDirectorStore.setState(createInitialDirectorState());

  useDirectorStore.getState().addPresetCharacter("female");
  useDirectorStore.getState().addPresetCharacter("teen");

  const characters = useDirectorStore.getState().project.objects.filter((item) => item.kind === "character");

  expect(characters[0].color).toBe("#4F8EF7");
  expect(new Set(characters.map((item) => item.color)).size).toBe(characters.length);
});

it("places newly added preset characters far enough from the default role to avoid overlap", () => {
  useDirectorStore.setState(createInitialDirectorState());

  useDirectorStore.getState().addPresetCharacter("female");
  useDirectorStore.getState().addPresetCharacter("teen");

  const characters = useDirectorStore.getState().project.objects.filter((item) => item.kind === "character");
  const defaultRole = characters.find((item) => item.id === "char_default_a");
  const role02 = characters.find((item) => item.name === "角色02");
  const role03 = characters.find((item) => item.name === "角色03");

  expect(defaultRole?.transform.position).toEqual([0, 0, 0]);
  expect(role02?.transform.position).toEqual([-1.25, 0, 0]);
  expect(role03?.transform.position).toEqual([1.25, 0, 0]);
});

it("adds selected geometry primitives as light blue-white prop objects", () => {
  useDirectorStore.setState(createInitialDirectorState());

  useDirectorStore.getState().addGeometryPrimitive("torus");

  const prop = useDirectorStore.getState().project.objects.find((item) => item.kind === "prop");

  expect(prop?.name).toBe("环状体");
  expect(prop?.geometryType).toBe("torus");
  expect(prop?.color).toBe("#d7e7ff");
  expect(useDirectorStore.getState().selectedObjectId).toBe(prop?.id);
});

it("deletes the selected list object and linked camera data", () => {
  useDirectorStore.setState(createInitialDirectorState());
  useDirectorStore.getState().addCameraShot();

  expect(useDirectorStore.getState().project.cameras).toHaveLength(2);

  useDirectorStore.getState().deleteSelectedObject();

  const state = useDirectorStore.getState();

  expect(state.selectedObjectId).toBeNull();
  expect(state.project.objects.some((item) => item.id === "cam_object_2")).toBe(false);
  expect(state.project.cameras.some((item) => item.id === "cam_2")).toBe(false);
  expect(state.project.activeCameraId).toBe("cam_1");
});

it("supports multi-selecting objects and deleting the selected set", () => {
  useDirectorStore.setState(createInitialDirectorState());
  useDirectorStore.getState().addPresetCharacter("female");

  useDirectorStore.getState().selectObject("char_default_a");
  useDirectorStore.getState().toggleObjectSelection("char_preset_2");

  expect(useDirectorStore.getState().selectedObjectId).toBe("char_preset_2");
  expect(useDirectorStore.getState().selectedObjectIds).toEqual(["char_default_a", "char_preset_2"]);

  useDirectorStore.getState().deleteSelectedObject();

  const state = useDirectorStore.getState();

  expect(state.selectedObjectId).toBeNull();
  expect(state.selectedObjectIds).toEqual([]);
  expect(state.project.objects.some((item) => item.id === "char_default_a")).toBe(false);
  expect(state.project.objects.some((item) => item.id === "char_preset_2")).toBe(false);
});

it("updates a character body type without changing transform or color", () => {
  useDirectorStore.setState(createInitialDirectorState());
  const character = useDirectorStore.getState().project.objects.find((item) => item.kind === "character");
  expect(character).toBeTruthy();

  useDirectorStore.getState().updateObjectColor(character!.id, "#123456");
  useDirectorStore.getState().updateObjectTransform(character!.id, { position: [1, 2, 3] });
  useDirectorStore.getState().updateCharacterBodyType(character!.id, "chibi");

  const updated = useDirectorStore.getState().project.objects.find((item) => item.id === character!.id);
  expect(updated?.bodyType).toBe("chibi");
  expect(updated?.color).toBe("#123456");
  expect(updated?.transform.position).toEqual([1, 2, 3]);
});

it("keeps imported local models separate from procedural body types", () => {
  useDirectorStore.setState(createInitialDirectorState());

  useDirectorStore.getState().addImportedAsset({
    kind: "prop",
    name: "本地道具",
    fileName: "cube.obj",
    url: "blob:local-model",
  });

  const imported = useDirectorStore.getState().project.objects.find((item) => item.assetRefId);

  expect(imported?.kind).toBe("prop");
  expect(imported?.bodyType).toBeUndefined();
  expect(imported?.characterRig).toBeUndefined();
});

it("keeps imported model object ids unique after deleting an earlier model", () => {
  useDirectorStore.setState(createInitialDirectorState());

  useDirectorStore.getState().addImportedAsset({
    kind: "prop",
    name: "模型A",
    fileName: "model-a.fbx",
    url: "blob:model-a",
  });
  const firstModelId = useDirectorStore.getState().selectedObjectId;

  useDirectorStore.getState().addImportedAsset({
    kind: "prop",
    name: "模型B",
    fileName: "model-b.fbx",
    url: "blob:model-b",
  });
  const secondModelId = useDirectorStore.getState().selectedObjectId;

  useDirectorStore.getState().selectObject(firstModelId);
  useDirectorStore.getState().deleteSelectedObject();

  useDirectorStore.getState().addImportedAsset({
    kind: "prop",
    name: "模型C",
    fileName: "model-c.fbx",
    url: "blob:model-c",
  });
  const thirdModelId = useDirectorStore.getState().selectedObjectId;
  const modelObjectIds = useDirectorStore
    .getState()
    .project.objects.filter((item) => item.assetRefId)
    .map((item) => item.id);

  expect(thirdModelId).not.toBe(secondModelId);
  expect(modelObjectIds).toHaveLength(2);
  expect(new Set(modelObjectIds).size).toBe(modelObjectIds.length);
});

it("replaces only the current panorama asset while preserving selection, panel, and undo semantics", () => {
  const initialState = createInitialDirectorState();
  const previousAssets: DirectorAssetRef[] = [
    {
      id: "asset_1",
      kind: "prop",
      sourceType: "model",
      fileName: "model.obj",
      name: "模型",
      url: "data:model",
      assetSource: "local",
    },
    {
      id: "asset_2",
      kind: "panorama",
      sourceType: "image",
      fileName: "stale.jpg",
      name: "旧的非当前全景",
      url: "data:image/jpeg;base64,stale",
      projectionMode: "equirectangular",
    },
    {
      id: "asset_3",
      kind: "panorama",
      sourceType: "image",
      fileName: "current.jpg",
      name: "当前全景",
      url: "data:image/jpeg;base64,current",
      projectionMode: "equirectangular",
    },
  ];

  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    ...initialState,
    selectedObjectId: "char_default_a",
    selectedObjectIds: ["char_default_a"],
    selectedCrowdId: null,
    directorInspectorMode: "auto",
    project: {
      ...initialState.project,
      assets: previousAssets,
      panoramaAssetId: "asset_3",
    },
    undoStack: [],
    undoBatchDepth: 0,
    undoBatchSnapshot: null,
    undoBatchHasTrackedChanges: false,
  });

  useDirectorStore.getState().addImportedAsset({
    kind: "panorama",
    name: "新全景",
    fileName: "new.jpg",
    url: "data:image/jpeg;base64,new",
    projectionMode: "equirectangular",
  });

  const importedState = useDirectorStore.getState();
  expect(importedState.project.panoramaAssetId).toBe("asset_4");
  expect(importedState.project.assets.map((asset) => asset.id)).toEqual(["asset_1", "asset_2", "asset_4"]);
  expect(importedState.project.assets.find((asset) => asset.id === "asset_1")?.url).toBe("data:model");
  expect(importedState.project.assets.find((asset) => asset.id === "asset_2")?.url).toBe(
    "data:image/jpeg;base64,stale"
  );
  expect(importedState.project.assets.find((asset) => asset.id === "asset_3")).toBeUndefined();
  expect(importedState.selectedObjectId).toBeNull();
  expect(importedState.selectedObjectIds).toEqual([]);
  expect(importedState.directorInspectorMode).toBe("scene");
  expect(importedState.undoStack).toHaveLength(1);

  importedState.undo();

  const undoneState = useDirectorStore.getState();
  expect(undoneState.project.panoramaAssetId).toBe("asset_3");
  expect(undoneState.project.assets.map((asset) => asset.id)).toEqual(["asset_1", "asset_2", "asset_3"]);
  expect(undoneState.selectedObjectId).toBe("char_default_a");
  expect(undoneState.selectedObjectIds).toEqual(["char_default_a"]);
  expect(undoneState.directorInspectorMode).toBe("auto");
});

it("preserves a model when panoramaAssetId points to a non-panorama asset", () => {
  const initialState = createInitialDirectorState();
  const modelAsset: DirectorAssetRef = {
    id: "asset_1",
    kind: "prop",
    sourceType: "model",
    fileName: "model.obj",
    name: "模型",
    url: "data:model",
    assetSource: "local",
  };

  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    ...initialState,
    project: {
      ...initialState.project,
      assets: [modelAsset],
      panoramaAssetId: modelAsset.id,
    },
    undoStack: [],
    undoBatchDepth: 0,
    undoBatchSnapshot: null,
    undoBatchHasTrackedChanges: false,
  });

  useDirectorStore.getState().addImportedAsset({
    kind: "panorama",
    name: "新全景",
    fileName: "new.jpg",
    url: "data:image/jpeg;base64,new",
    projectionMode: "equirectangular",
  });

  const state = useDirectorStore.getState();
  expect(state.project.assets.find((asset) => asset.id === modelAsset.id)).toEqual(modelAsset);
  expect(state.project.panoramaAssetId).toBe("asset_2");
  expect(state.project.assets.find((asset) => asset.id === "asset_2")?.kind).toBe("panorama");
});

it("adds a new camera from the current viewport snapshot", () => {
  useDirectorStore.setState(createInitialDirectorState());

  useDirectorStore.getState().addCameraShot({
    fov: 62,
    position: [4, 3, 2],
    target: [0.5, 1.1, -2],
  });

  const state = useDirectorStore.getState();
  const addedCamera = state.project.cameras[state.project.cameras.length - 1];
  const addedObject = state.project.objects.find((item) => item.linkedCameraId === addedCamera?.id);
  const rigPosition = getCameraRigPositionFromViewSnapshot({
    fov: 62,
    position: [4, 3, 2],
    target: [0.5, 1.1, -2],
  });

  expect(addedCamera?.fov).toBe(62);
  expect(addedCamera?.transform.position).toEqual(rigPosition);
  expect(addedCamera?.target).toEqual([0.5, 1.1, -2]);
  expect(addedObject?.transform.position).toEqual(rigPosition);
  expect(state.project.activeCameraId).toBe(addedCamera?.id);
  expect(state.selectedObjectId).toBe(addedObject?.id);
});

it("keeps object-focused cameras centered when the target model moves", () => {
  useDirectorStore.setState(createInitialDirectorState());

  useDirectorStore.getState().addGeometryPrimitive("box");
  const targetObject = useDirectorStore.getState().project.objects.find((item) => item.name === "立方体");
  expect(targetObject).toBeTruthy();

  useDirectorStore.getState().updateCamera("cam_1", {
    targetMode: "object",
    targetObjectId: targetObject!.id,
    target: [-1.725, 0.5, 1.15],
  });
  useDirectorStore.getState().updateObjectTransform(targetObject!.id, { position: [2, 0, -3] });

  const camera = useDirectorStore.getState().project.cameras[0];

  expect(camera.targetMode).toBe("object");
  expect(camera.targetObjectId).toBe(targetObject!.id);
  expect(camera.target).toEqual([2, 0.5, -3]);
});

it("appends camera captures with sequential camera-shot names", () => {
  useDirectorStore.setState(createInitialDirectorState());

  useDirectorStore.getState().addCameraCaptures("cam_1", ["data:image/png;base64,a"]);
  useDirectorStore.getState().addCameraCaptures("cam_1", [
    "data:image/png;base64,b",
    "data:image/png;base64,c",
  ]);

  const camera = useDirectorStore.getState().project.cameras[0];

  expect(camera.captures).toEqual([
    {
      id: "cam_1-capture-01",
      index: 1,
      name: "机位01-截图01",
      dataUrl: "data:image/png;base64,a",
    },
    {
      id: "cam_1-capture-02",
      index: 2,
      name: "机位01-截图02",
      dataUrl: "data:image/png;base64,b",
    },
    {
      id: "cam_1-capture-03",
      index: 3,
      name: "机位01-截图03",
      dataUrl: "data:image/png;base64,c",
    },
  ]);
  expect(camera.lastCaptureUrl).toBe("data:image/png;base64,c");
});

it("auto-persists the latest director scene snapshot after scene changes", () => {
  useDirectorStore.getState().setViewportAspectRatio("16:9");
  useDirectorStore.getState().toggleViewportPanelsCollapsed();
  useDirectorStore.getState().addPresetCharacter("female");
  useDirectorStore.getState().updateScene({ backgroundColor: "#151515" });

  const snapshot = localStorage.getItem("storyai-3d-director-desk-demo");
  expect(snapshot).not.toBeNull();

  const parsed = JSON.parse(snapshot ?? "{}") as {
    viewportAspectRatio?: string;
    viewportPanelsCollapsed?: boolean;
    project?: {
      scene?: {
        backgroundColor?: string;
      };
      objects?: Array<{ id: string; name: string }>;
    };
  };

  expect(parsed.viewportAspectRatio).toBe("16:9");
  expect(parsed.viewportPanelsCollapsed).toBe(true);
  expect(parsed.project?.scene?.backgroundColor).toBe("#151515");
  expect(parsed.project?.objects?.some((item) => item.name === "角色02")).toBe(true);
});

it("keeps persisted director scenes isolated per canvas card instance", () => {
  useDirectorStore.getState().openScopedScene("node_director_a");
  useDirectorStore.getState().setViewportAspectRatio("16:9");
  useDirectorStore.getState().updateScene({ backgroundColor: "#151515" });

  expect(localStorage.getItem("storyai-3d-director-desk-demo:node_director_a")).not.toBeNull();

  useDirectorStore.getState().openScopedScene("node_director_b");

  expect(useDirectorStore.getState().viewportAspectRatio).toBe("auto");
  expect(useDirectorStore.getState().project.scene.backgroundColor).toBe("#000000");

  useDirectorStore.getState().updateScene({ backgroundColor: "#303640" });

  expect(localStorage.getItem("storyai-3d-director-desk-demo:node_director_b")).not.toBeNull();

  useDirectorStore.getState().openScopedScene("node_director_a");

  expect(useDirectorStore.getState().viewportAspectRatio).toBe("16:9");
  expect(useDirectorStore.getState().project.scene.backgroundColor).toBe("#151515");

  useDirectorStore.getState().openScopedScene("node_director_b");

  expect(useDirectorStore.getState().viewportAspectRatio).toBe("auto");
  expect(useDirectorStore.getState().project.scene.backgroundColor).toBe("#303640");
});

it("hydrates the initial state from the persisted director scene snapshot", () => {
  localStorage.setItem(
    "storyai-3d-director-desk-demo",
    JSON.stringify({
      viewMode: "camera",
      selectedObjectId: "char_default_a",
      selectedObjectIds: ["char_default_a"],
      directorInspectorMode: "auto",
      transformMode: "rotate",
      viewportAspectRatio: "9:16",
      viewportRuleOfThirdsEnabled: true,
      viewportPanelsCollapsed: true,
      project: {
        ...createDefaultDirectorProject(),
        scene: {
          ...createDefaultDirectorProject().scene,
          backgroundColor: "#303640",
        },
      },
    })
  );

  const hydratedState = createInitialDirectorState({
    includePersistedLocalAssets: true,
    includePersistedScene: true,
  });

  expect(hydratedState.viewMode).toBe("camera");
  expect(hydratedState.transformMode).toBe("rotate");
  expect(hydratedState.viewportAspectRatio).toBe("9:16");
  expect(hydratedState.viewportRuleOfThirdsEnabled).toBe(true);
  expect(hydratedState.viewportPanelsCollapsed).toBe(true);
  expect(hydratedState.selectedObjectId).toBe("char_default_a");
  expect(hydratedState.project.scene.backgroundColor).toBe("#303640");
});

it("migrates persisted procedural characters to the built-in UE4 mannequin rig", () => {
  const legacyProject = createDefaultDirectorProject();
  const legacyCharacter = legacyProject.objects.find((item) => item.kind === "character");

  if (!legacyCharacter) {
    throw new Error("Expected default character");
  }

  legacyCharacter.color = "#4F8EF7";
  legacyCharacter.transform.position = [1, 0, -2];
  legacyCharacter.characterRig = {
    rigType: "mannequin",
    posePresetId: "stand",
    controls: {
      "head.yaw": 12,
    },
  };

  localStorage.setItem(
    "storyai-3d-director-desk-demo",
    JSON.stringify({
      ...createInitialDirectorState(),
      project: legacyProject,
    })
  );

  const hydratedState = createInitialDirectorState({
    includePersistedScene: true,
  });
  const migratedCharacter = hydratedState.project.objects.find((item) => item.id === legacyCharacter.id);

  expect(migratedCharacter?.transform.position).toEqual([1, 0, -2]);
  expect(migratedCharacter?.color).toBe("#4F8EF7");
  expect(migratedCharacter?.characterRig).toEqual({
    rigType: "ue4-mannequin",
    posePresetId: "stand",
    controls: {
      "head.yaw": 12,
    },
  });
});

it("adds the built-in UE4 mannequin rig to persisted characters that predate rig metadata", () => {
  const legacyProject = createDefaultDirectorProject();
  const legacyCharacter = legacyProject.objects.find((item) => item.kind === "character");

  if (!legacyCharacter) {
    throw new Error("Expected default character");
  }

  delete legacyCharacter.characterRig;

  localStorage.setItem(
    "storyai-3d-director-desk-demo",
    JSON.stringify({
      ...createInitialDirectorState(),
      project: legacyProject,
    })
  );

  const hydratedState = createInitialDirectorState({
    includePersistedScene: true,
  });
  const migratedCharacter = hydratedState.project.objects.find((item) => item.id === legacyCharacter.id);

  expect(migratedCharacter?.characterRig).toEqual({
    rigType: "ue4-mannequin",
    posePresetId: "stand",
    controls: {},
  });
});

it("copies and pastes the current selection as new scene objects", () => {
  useDirectorStore.getState().selectObject("char_default_a");

  useDirectorStore.getState().copySelectedObjects();
  useDirectorStore.getState().pasteClipboardObjects();

  const state = useDirectorStore.getState();
  const characters = state.project.objects.filter((item) => item.kind === "character");
  const pastedCharacter = characters.find((item) => item.id !== "char_default_a");

  expect(characters).toHaveLength(2);
  expect(pastedCharacter?.id).not.toBe("char_default_a");
  expect(pastedCharacter?.transform.position).toEqual([0.6, 0, 0.6]);
  expect(state.selectedObjectId).toBe(pastedCharacter?.id ?? null);
  expect(state.selectedObjectIds).toEqual(pastedCharacter ? [pastedCharacter.id] : []);
});

it("undoes the latest scene mutation", () => {
  useDirectorStore.getState().addPresetCharacter("female");

  expect(useDirectorStore.getState().project.objects.some((item) => item.name === "角色02")).toBe(true);

  useDirectorStore.getState().undo();

  expect(useDirectorStore.getState().project.objects.some((item) => item.name === "角色02")).toBe(false);
  expect(useDirectorStore.getState().project.objects.filter((item) => item.kind === "character")).toHaveLength(1);
});

it("marks and finalizes a temporary capture camera without adding undo entries", () => {
  const actions = useDirectorStore.getState() as ReturnType<typeof useDirectorStore.getState> & {
    markTemporaryCameraCapture: (cameraId: string, token: string) => void;
    finalizeTemporaryCameraCapture: (cameraId: string, token: string) => void;
  };
  const cameraId = useDirectorStore.getState().addCameraShot();
  const token = "capture-token-finalize";
  const undoLengthBeforeMark = useDirectorStore.getState().undoStack.length;

  actions.markTemporaryCameraCapture(cameraId, token);

  expect(
    (useDirectorStore.getState().project.cameras.find((camera) => camera.id === cameraId) as {
      transientCaptureToken?: string;
    })?.transientCaptureToken
  ).toBe(token);
  expect(
    (JSON.parse(localStorage.getItem("storyai-3d-director-desk-demo") ?? "{}") as {
      project?: { cameras?: Array<{ id: string; transientCaptureToken?: string }> };
    }).project?.cameras?.find((camera) => camera.id === cameraId)?.transientCaptureToken
  ).toBe(token);
  expect(useDirectorStore.getState().undoStack).toHaveLength(undoLengthBeforeMark);

  useDirectorStore.getState().addCameraCaptures(cameraId, ["data:image/png;base64,success"]);
  actions.finalizeTemporaryCameraCapture(cameraId, token);

  expect(
    (useDirectorStore.getState().project.cameras.find((camera) => camera.id === cameraId) as {
      transientCaptureToken?: string;
    })?.transientCaptureToken
  ).toBeUndefined();
  expect(
    (JSON.parse(localStorage.getItem("storyai-3d-director-desk-demo") ?? "{}") as {
      project?: { cameras?: Array<{ id: string; transientCaptureToken?: string }> };
    }).project?.cameras?.find((camera) => camera.id === cameraId)?.transientCaptureToken
  ).toBeUndefined();
  expect(useDirectorStore.getState().undoStack).toHaveLength(undoLengthBeforeMark + 1);
  expect(
    useDirectorStore.getState().undoStack.some((snapshot) =>
      snapshot.project.cameras.some(
        (camera) =>
          camera.id === cameraId &&
          (camera as typeof camera & { transientCaptureToken?: string }).transientCaptureToken === token
      )
    )
  ).toBe(false);
});

it("commits captures only when the temporary camera token still matches", () => {
  const actions = useDirectorStore.getState() as ReturnType<typeof useDirectorStore.getState> & {
    markTemporaryCameraCapture: (cameraId: string, token: string) => void;
    commitTemporaryCameraCapture: (cameraId: string, token: string, dataUrls: string[]) => boolean;
  };
  const cameraId = useDirectorStore.getState().addCameraShot();
  const token = "capture-token-commit";
  actions.markTemporaryCameraCapture(cameraId, token);

  expect(actions.commitTemporaryCameraCapture(cameraId, token, ["data:image/png;base64,committed"])).toBe(true);

  const committedCamera = useDirectorStore.getState().project.cameras.find((camera) => camera.id === cameraId);
  expect(committedCamera?.captures?.map((capture) => capture.dataUrl)).toEqual(["data:image/png;base64,committed"]);
  expect(committedCamera?.transientCaptureToken).toBeUndefined();
  expect(
    useDirectorStore.getState().undoStack[useDirectorStore.getState().undoStack.length - 1]?.project.cameras.find(
      (camera) => camera.id === cameraId
    )
      ?.transientCaptureToken
  ).toBeUndefined();

  const staleCameraId = useDirectorStore.getState().addCameraShot();
  actions.markTemporaryCameraCapture(staleCameraId, "current-token");
  const beforeStaleCommit = useDirectorStore.getState().project;
  expect(actions.commitTemporaryCameraCapture(staleCameraId, "old-token", ["data:image/png;base64,stale"])).toBe(false);
  expect(useDirectorStore.getState().project).toEqual(beforeStaleCommit);
});

it("rolls back only the tokenized capture camera and prevents undo from reviving it", () => {
  const actions = useDirectorStore.getState() as ReturnType<typeof useDirectorStore.getState> & {
    markTemporaryCameraCapture: (cameraId: string, token: string) => void;
    rollbackTemporaryCameraCapture: (input: {
      cameraId: string;
      token: string;
      previousActiveCameraId: string | null;
      previousSelectedObjectId: string | null;
      previousSelectedObjectIds: string[];
      previousSelectedCrowdId: string | null;
      previousViewMode?: "director" | "camera";
    }) => void;
  };
  const before = useDirectorStore.getState();
  const cameraId = useDirectorStore.getState().addCameraShot();
  const token = "capture-token-rollback";
  actions.markTemporaryCameraCapture(cameraId, token);
  useDirectorStore.getState().addPresetCharacter("female");

  actions.rollbackTemporaryCameraCapture({
    cameraId,
    token,
    previousActiveCameraId: before.project.activeCameraId,
    previousSelectedObjectId: before.selectedObjectId,
    previousSelectedObjectIds: [...before.selectedObjectIds],
    previousSelectedCrowdId: before.selectedCrowdId,
    previousViewMode: before.viewMode,
  });

  const afterRollback = useDirectorStore.getState();
  expect(afterRollback.project.cameras.some((camera) => camera.id === cameraId)).toBe(false);
  expect(afterRollback.project.objects.some((item) => item.linkedCameraId === cameraId)).toBe(false);
  expect(afterRollback.project.objects.some((item) => item.kind === "character" && item.id !== "char_default_a")).toBe(true);
  expect(afterRollback.project.activeCameraId).toBe(before.project.activeCameraId);
  expect(afterRollback.selectedObjectId).toBe(before.selectedObjectId);
  expect(afterRollback.selectedObjectIds).toEqual(before.selectedObjectIds);
  expect(afterRollback.selectedCrowdId).toBe(before.selectedCrowdId);
  expect(afterRollback.viewMode).toBe(before.viewMode);
  expect(
    afterRollback.undoStack.some((snapshot) =>
      snapshot.project.cameras.some((camera) => camera.id === cameraId)
    )
  ).toBe(false);

  afterRollback.undo();
  expect(useDirectorStore.getState().project.cameras.some((camera) => camera.id === cameraId)).toBe(false);
});

it("does not remove a replacement camera with the same id when its token is absent", () => {
  const actions = useDirectorStore.getState() as ReturnType<typeof useDirectorStore.getState> & {
    markTemporaryCameraCapture: (cameraId: string, token: string) => void;
    rollbackTemporaryCameraCapture: (input: {
      cameraId: string;
      token: string;
      previousActiveCameraId: string | null;
      previousSelectedObjectId: string | null;
      previousSelectedObjectIds: string[];
      previousSelectedCrowdId: string | null;
    }) => void;
  };
  const before = useDirectorStore.getState();
  const cameraId = useDirectorStore.getState().addCameraShot();
  const token = "capture-token-replaced";
  actions.markTemporaryCameraCapture(cameraId, token);
  useDirectorStore.getState().undo();
  const replacementId = useDirectorStore.getState().addCameraShot();

  expect(replacementId).toBe(cameraId);
  const replacementBeforeRollback = useDirectorStore.getState();
  actions.rollbackTemporaryCameraCapture({
    cameraId,
    token,
    previousActiveCameraId: before.project.activeCameraId,
    previousSelectedObjectId: before.selectedObjectId,
    previousSelectedObjectIds: [...before.selectedObjectIds],
    previousSelectedCrowdId: before.selectedCrowdId,
  });

  const state = useDirectorStore.getState();
  expect(state.project.cameras.some((camera) => camera.id === replacementId)).toBe(true);
  expect(state.project.objects.some((item) => item.linkedCameraId === replacementId)).toBe(true);
  expect(
    (state.project.cameras.find((camera) => camera.id === replacementId) as {
      transientCaptureToken?: string;
    })?.transientCaptureToken
  ).toBeUndefined();
  expect(state.project).toEqual(replacementBeforeRollback.project);
  expect(state.viewMode).toBe(replacementBeforeRollback.viewMode);
  expect(state.project.activeCameraId).toBe(replacementBeforeRollback.project.activeCameraId);
  expect(state.selectedObjectId).toBe(replacementBeforeRollback.selectedObjectId);
  expect(state.selectedObjectIds).toEqual(replacementBeforeRollback.selectedObjectIds);
  expect(state.selectedCrowdId).toBe(replacementBeforeRollback.selectedCrowdId);
});

it("normalizes only tokenized transaction snapshots to the capture baseline", () => {
  const actions = useDirectorStore.getState() as ReturnType<typeof useDirectorStore.getState> & {
    markTemporaryCameraCapture: (cameraId: string, token: string) => void;
    rollbackTemporaryCameraCapture: (input: {
      cameraId: string;
      token: string;
      previousActiveCameraId: string | null;
      previousSelectedObjectId: string | null;
      previousSelectedObjectIds: string[];
      previousSelectedCrowdId: string | null;
      previousViewMode?: "director" | "camera";
      previousDirectorInspectorMode?: "auto" | "scene";
    }) => void;
  };
  const cameraId = useDirectorStore.getState().addCameraShot();
  const token = "capture-token-snapshot-normalize";
  actions.markTemporaryCameraCapture(cameraId, token);
  const tokenizedState = useDirectorStore.getState();
  useDirectorStore.getState().addPresetCharacter("female");
  const cameraObjectId = tokenizedState.project.objects.find((item) => item.linkedCameraId === cameraId)?.id;
  const historicalSnapshot = createInitialDirectorState();
  const tokenSnapshot = {
    viewMode: "camera" as const,
    selectedObjectId: cameraObjectId ?? null,
    selectedObjectIds: [cameraObjectId ?? "", "char_default_a"],
    selectedCrowdId: "crowd-that-is-not-in-project",
    directorInspectorMode: "auto" as const,
    transformMode: "translate" as const,
    viewportAspectRatio: "auto" as const,
    viewportRuleOfThirdsEnabled: false,
    viewportPanelsCollapsed: false,
    project: {
      ...tokenizedState.project,
      activeCameraId: cameraId,
    },
  };
  useDirectorStore.setState({
    ...useDirectorStore.getState(),
    undoStack: [historicalSnapshot, tokenSnapshot],
    undoBatchSnapshot: tokenSnapshot,
  });

  actions.rollbackTemporaryCameraCapture({
    cameraId,
    token,
    previousActiveCameraId: "cam_1",
    previousSelectedObjectId: "char_default_a",
    previousSelectedObjectIds: ["char_default_a", "missing-object"],
    previousSelectedCrowdId: null,
    previousViewMode: "director",
    previousDirectorInspectorMode: "scene",
  });

  const state = useDirectorStore.getState();
  expect(state.undoStack[0]).toEqual(historicalSnapshot);
  const normalizedSnapshot = state.undoStack[1];
  expect(normalizedSnapshot?.project.cameras.some((camera) => camera.id === cameraId)).toBe(false);
  expect(normalizedSnapshot?.project.objects.some((item) => item.linkedCameraId === cameraId)).toBe(false);
  expect(normalizedSnapshot?.project.activeCameraId).toBe("cam_1");
  expect(normalizedSnapshot?.viewMode).toBe("director");
  expect(normalizedSnapshot?.directorInspectorMode).toBe("scene");
  expect(normalizedSnapshot?.selectedObjectId).toBe("char_default_a");
  expect(normalizedSnapshot?.selectedObjectIds).toEqual(["char_default_a"]);
  expect(normalizedSnapshot?.selectedCrowdId).toBeNull();
  expect(state.undoBatchSnapshot).toEqual(normalizedSnapshot);

  state.undo();
  expect(useDirectorStore.getState().viewMode).toBe("director");
  expect(useDirectorStore.getState().directorInspectorMode).toBe("scene");
  expect(useDirectorStore.getState().selectedObjectId).toBe("char_default_a");
  expect(useDirectorStore.getState().selectedObjectIds).toEqual(["char_default_a"]);
  expect(useDirectorStore.getState().selectedCrowdId).toBeNull();
});

it("removes a trailing no-op undo snapshot after a simple capture rollback", () => {
  const actions = useDirectorStore.getState() as ReturnType<typeof useDirectorStore.getState> & {
    markTemporaryCameraCapture: (cameraId: string, token: string) => void;
    rollbackTemporaryCameraCapture: (input: {
      cameraId: string;
      token: string;
      previousActiveCameraId: string | null;
      previousSelectedObjectId: string | null;
      previousSelectedObjectIds: string[];
      previousSelectedCrowdId: string | null;
      previousViewMode?: "director" | "camera";
      previousDirectorInspectorMode?: "auto" | "scene";
    }) => void;
  };
  const before = useDirectorStore.getState();
  const cameraId = useDirectorStore.getState().addCameraShot();
  actions.markTemporaryCameraCapture(cameraId, "capture-token-no-op");

  actions.rollbackTemporaryCameraCapture({
    cameraId,
    token: "capture-token-no-op",
    previousActiveCameraId: before.project.activeCameraId,
    previousSelectedObjectId: before.selectedObjectId,
    previousSelectedObjectIds: [...before.selectedObjectIds],
    previousSelectedCrowdId: before.selectedCrowdId,
    previousViewMode: before.viewMode,
    previousDirectorInspectorMode: before.directorInspectorMode,
  });

  expect(useDirectorStore.getState().undoStack).toHaveLength(0);
});

it("keeps a real user edit as the first undo after capture rollback", () => {
  const actions = useDirectorStore.getState() as ReturnType<typeof useDirectorStore.getState> & {
    markTemporaryCameraCapture: (cameraId: string, token: string) => void;
    rollbackTemporaryCameraCapture: (input: {
      cameraId: string;
      token: string;
      previousActiveCameraId: string | null;
      previousSelectedObjectId: string | null;
      previousSelectedObjectIds: string[];
      previousSelectedCrowdId: string | null;
      previousViewMode?: "director" | "camera";
      previousDirectorInspectorMode?: "auto" | "scene";
    }) => void;
  };
  const before = useDirectorStore.getState();
  const cameraId = useDirectorStore.getState().addCameraShot();
  const token = "capture-token-real-edit";
  actions.markTemporaryCameraCapture(cameraId, token);
  useDirectorStore.getState().addPresetCharacter("female");

  actions.rollbackTemporaryCameraCapture({
    cameraId,
    token,
    previousActiveCameraId: before.project.activeCameraId,
    previousSelectedObjectId: before.selectedObjectId,
    previousSelectedObjectIds: [...before.selectedObjectIds],
    previousSelectedCrowdId: before.selectedCrowdId,
    previousViewMode: before.viewMode,
    previousDirectorInspectorMode: before.directorInspectorMode,
  });

  expect(useDirectorStore.getState().project.objects.some((item) => item.name === "角色02")).toBe(true);
  useDirectorStore.getState().undo();
  expect(useDirectorStore.getState().project.objects.some((item) => item.name === "角色02")).toBe(false);
  expect(useDirectorStore.getState().project.cameras.some((camera) => camera.id === cameraId)).toBe(false);
});

it("deduplicates adjacent rollback baselines so two undos reach earlier history", () => {
  const actions = useDirectorStore.getState() as ReturnType<typeof useDirectorStore.getState> & {
    markTemporaryCameraCapture: (cameraId: string, token: string) => void;
    rollbackTemporaryCameraCapture: (input: {
      cameraId: string;
      token: string;
      previousActiveCameraId: string | null;
      previousSelectedObjectId: string | null;
      previousSelectedObjectIds: string[];
      previousSelectedCrowdId: string | null;
      previousViewMode?: "director" | "camera";
      previousDirectorInspectorMode?: "auto" | "scene";
    }) => void;
  };

  useDirectorStore.getState().addPresetCharacter("female");
  const beforeCapture = useDirectorStore.getState();
  const cameraId = useDirectorStore.getState().addCameraShot();
  const token = "capture-token-duplicate-baseline";
  actions.markTemporaryCameraCapture(cameraId, token);
  useDirectorStore.getState().addPresetCharacter("broad");

  actions.rollbackTemporaryCameraCapture({
    cameraId,
    token,
    previousActiveCameraId: beforeCapture.project.activeCameraId,
    previousSelectedObjectId: beforeCapture.selectedObjectId,
    previousSelectedObjectIds: [...beforeCapture.selectedObjectIds],
    previousSelectedCrowdId: beforeCapture.selectedCrowdId,
    previousViewMode: beforeCapture.viewMode,
    previousDirectorInspectorMode: beforeCapture.directorInspectorMode,
  });

  expect(useDirectorStore.getState().project.objects.some((item) => item.name === "角色02")).toBe(true);
  expect(useDirectorStore.getState().project.objects.some((item) => item.name === "角色03")).toBe(true);

  useDirectorStore.getState().undo();
  expect(useDirectorStore.getState().project.objects.some((item) => item.name === "角色03")).toBe(false);
  expect(useDirectorStore.getState().project.objects.some((item) => item.name === "角色02")).toBe(true);

  const afterFirstUndo = JSON.stringify(useDirectorStore.getState().project);
  useDirectorStore.getState().undo();
  expect(JSON.stringify(useDirectorStore.getState().project)).not.toBe(afterFirstUndo);
  expect(useDirectorStore.getState().project.objects.some((item) => item.name === "角色02")).toBe(false);
});

it("removes transient capture cameras and linked objects during persisted hydration", () => {
  const project = createDefaultDirectorProject();
  const temporaryCameraId = "cam_hydration_temp";
  const temporaryObjectId = "cam_object_hydration_temp";
  const temporaryObject = {
    ...project.objects.find((item) => item.kind === "camera")!,
    id: temporaryObjectId,
    name: "临时机位",
    linkedCameraId: temporaryCameraId,
  };
  project.cameras = [
    {
      ...project.cameras[0]!,
      targetMode: "object",
      targetObjectId: temporaryObjectId,
    },
    {
      ...project.cameras[0]!,
      id: temporaryCameraId,
      name: "临时机位",
      transientCaptureToken: "hydrate-token",
    },
  ];
  project.objects = [...project.objects, temporaryObject];
  project.activeCameraId = temporaryCameraId;

  localStorage.setItem(
    "storyai-3d-director-desk-demo",
    JSON.stringify({
      ...createInitialDirectorState(),
      viewMode: "camera",
      selectedObjectId: temporaryObjectId,
      selectedObjectIds: [temporaryObjectId, "char_default_a"],
      selectedCrowdId: "temporary-crowd",
      project,
    })
  );

  const hydratedState = createInitialDirectorState({ includePersistedScene: true });
  expect(hydratedState.project.cameras.some((camera) => camera.id === temporaryCameraId)).toBe(false);
  expect(hydratedState.project.objects.some((item) => item.id === temporaryObjectId)).toBe(false);
  expect(hydratedState.project.objects.some((item) => item.id === "char_default_a")).toBe(true);
  expect(hydratedState.project.activeCameraId).toBe("cam_1");
  expect(hydratedState.project.cameras[0]?.targetObjectId).toBeNull();
  expect(hydratedState.selectedObjectId).toBeNull();
  expect(hydratedState.selectedObjectIds).toEqual(["char_default_a"]);
  expect(hydratedState.selectedCrowdId).toBeNull();
});

it("sanitizes transient capture cameras from a persisted project-shaped import", () => {
  const project = createDefaultDirectorProject();
  project.cameras.push({ ...project.cameras[0]!, id: "cam_import_temp", transientCaptureToken: "import-token" });
  project.objects.push({
    ...project.objects.find((item) => item.kind === "camera")!,
    id: "cam_object_import_temp",
    linkedCameraId: "cam_import_temp",
  });

  localStorage.setItem("storyai-3d-director-desk-demo", JSON.stringify(project));

  const hydratedState = createInitialDirectorState({ includePersistedScene: true });
  expect(hydratedState.project.cameras.some((camera) => camera.id === "cam_import_temp")).toBe(false);
  expect(hydratedState.project.objects.some((item) => item.id === "cam_object_import_temp")).toBe(false);
  expect(hydratedState.project.cameras).toHaveLength(1);
  expect(hydratedState.project.objects).toHaveLength(2);
});

it("sanitizes transient capture cameras when replacing an imported project", () => {
  const project = createDefaultDirectorProject();
  project.cameras.push({ ...project.cameras[0]!, id: "cam_replace_temp", transientCaptureToken: "replace-token" });
  project.objects.push({
    ...project.objects.find((item) => item.kind === "camera")!,
    id: "cam_object_replace_temp",
    linkedCameraId: "cam_replace_temp",
  });

  useDirectorStore.getState().replaceProject(project);

  const state = useDirectorStore.getState();
  expect(state.project.cameras.some((camera) => camera.id === "cam_replace_temp")).toBe(false);
  expect(state.project.objects.some((item) => item.id === "cam_object_replace_temp")).toBe(false);
  expect(state.project.cameras).toHaveLength(1);
  expect(state.project.objects).toHaveLength(2);
});

it("groups repeated transform updates into one undo step while batching", () => {
  useDirectorStore.getState().beginUndoBatch();
  useDirectorStore.getState().updateObjectTransform("char_default_a", { position: [1, 0, 0] });
  useDirectorStore.getState().updateObjectTransform("char_default_a", { position: [2, 0, 0] });
  useDirectorStore.getState().updateObjectTransform("char_default_a", { position: [3, 0, 0] });
  useDirectorStore.getState().endUndoBatch();

  expect(useDirectorStore.getState().project.objects.find((item) => item.id === "char_default_a")?.transform.position).toEqual([
    3, 0, 0,
  ]);

  useDirectorStore.getState().undo();

  expect(useDirectorStore.getState().project.objects.find((item) => item.id === "char_default_a")?.transform.position).toEqual([
    0, 0, 0,
  ]);
});

describe("recordCameraNode", () => {
  it("appends a camera node to the active camera with sequential ids and times", () => {
    useDirectorStore.getState().recordCameraNode("cam_1", {
      position: [0, 1.55, 5.4],
      rotation: [0, 0, 0, 1],
      fov: 50,
    });
    useDirectorStore.getState().recordCameraNode("cam_1", {
      position: [1, 1.55, 4],
      rotation: [0, 0, 0, 1],
      fov: 50,
    });

    const nodes = useDirectorStore.getState().project.cameras.find((item) => item.id === "cam_1")?.nodes ?? [];

    expect(nodes.map((item) => item.id)).toEqual(["node_1", "node_2"]);
    expect(nodes.map((item) => item.time)).toEqual([0, 1]);
    expect(nodes[0].position).toEqual([0, 1.55, 5.4]);
    expect(nodes[0].rotation).toEqual([0, 0, 0, 1]);
    expect(nodes[0].fov).toBe(50);
  });

  it("writes the camera rig transform behind the view point and updates the target", () => {
    useDirectorStore.getState().recordCameraNode("cam_1", {
      position: [0, 1.55, 5.4],
      rotation: [0, 0, 0, 1],
      fov: 50,
    });

    const camera = useDirectorStore.getState().project.cameras.find((item) => item.id === "cam_1");
    const rig = camera?.transform.position ?? [];

    // 视点沿 -Z 后退一个视锥深度 = rig 位置
    expect(rig[0]).toBeCloseTo(0, 5);
    expect(rig[1]).toBeCloseTo(1.55, 5);
    expect(rig[2]).toBeCloseTo(5.4 + VIEWPORT_CAMERA_FRUSTUM_DEPTH, 5);

    // target 更新为"当前注视点"：视点 + 朝向 × 原视点-目标距离
    const radius = Math.hypot(0.5, 5.4);
    expect(camera?.target[0]).toBeCloseTo(0, 5);
    expect(camera?.target[1]).toBeCloseTo(1.55, 5);
    expect(camera?.target[2]).toBeCloseTo(5.4 - radius, 5);

    expect(camera?.transform.rotation).toEqual([0, 0, 0]);
  });

  it("keeps the camera object gizmo in sync with the rig transform", () => {
    useDirectorStore.getState().recordCameraNode("cam_1", {
      position: [0, 1.55, 5.4],
      rotation: [0, 0, 0, 1],
      fov: 50,
    });

    const cameraObject = useDirectorStore
      .getState()
      .project.objects.find((item) => item.kind === "camera" && item.linkedCameraId === "cam_1");

    expect(cameraObject?.transform.position).toEqual(
      useDirectorStore.getState().project.cameras.find((item) => item.id === "cam_1")?.transform.position
    );
  });

  it("converts a yawed quaternion into the matching rig position and euler rotation", () => {
    useDirectorStore.getState().recordCameraNode("cam_1", {
      position: [0, 1.55, 5.4],
      rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], // yaw 90°
      fov: 50,
    });

    const camera = useDirectorStore.getState().project.cameras.find((item) => item.id === "cam_1");
    const rig = camera?.transform.position ?? [];

    // forward = (-1, 0, 0)，rig = 视点 + forward * depth = 视点 + (1.82, 0, 0)
    expect(rig[0]).toBeCloseTo(VIEWPORT_CAMERA_FRUSTUM_DEPTH, 5);
    expect(rig[1]).toBeCloseTo(1.55, 5);
    expect(rig[2]).toBeCloseTo(5.4, 5);
    expect(camera?.transform.rotation[1]).toBeCloseTo(Math.PI / 2, 5);
  });

  it("undoes a recorded node", () => {
    useDirectorStore.getState().recordCameraNode("cam_1", {
      position: [0, 1.55, 5.4],
      rotation: [0, 0, 0, 1],
      fov: 50,
    });

    expect(useDirectorStore.getState().project.cameras.find((item) => item.id === "cam_1")?.nodes).toHaveLength(1);

    useDirectorStore.getState().undo();

    const camera = useDirectorStore.getState().project.cameras.find((item) => item.id === "cam_1");
    expect(camera?.nodes).toBeUndefined();
    expect(camera?.transform.position).toEqual(
      createDefaultDirectorProject().cameras[0].transform.position
    );
  });
});

describe("syncCameraPose", () => {
  it("updates the camera rig transform and target without recording a node", () => {
    useDirectorStore.getState().syncCameraPose("cam_1", {
      position: [0, 1.55, 5.4],
      rotation: [0, 0, 0, 1],
      fov: 50,
    });

    const camera = useDirectorStore.getState().project.cameras.find((item) => item.id === "cam_1");
    expect(camera?.nodes ?? []).toHaveLength(0);
    expect(camera?.transform.position[2]).toBeCloseTo(5.4 + VIEWPORT_CAMERA_FRUSTUM_DEPTH, 5);
  });

  it("preserves the real object target while syncing a tracked camera pose", () => {
    const targetObject = useDirectorStore.getState().project.objects.find((item) => item.id === "char_default_a");
    expect(targetObject).toBeTruthy();

    useDirectorStore.getState().updateCamera("cam_1", {
      targetMode: "object",
      targetObjectId: targetObject!.id,
      target: [9, 9, 9],
    });
    useDirectorStore.getState().syncCameraPose("cam_1", {
      position: [3, 2, 6],
      rotation: [0, 0, 0, 1],
      fov: 50,
    });

    const camera = useDirectorStore.getState().project.cameras.find((item) => item.id === "cam_1");
    expect(camera?.targetMode).toBe("object");
    expect(camera?.targetObjectId).toBe(targetObject!.id);
    expect(camera?.target).toEqual(getDirectorObjectFocusTarget(targetObject!));
  });
});

describe("updateCameraSegment", () => {
  function recordTwoNodes() {
    useDirectorStore.getState().recordCameraNode("cam_1", {
      position: [0, 1.55, 5.4],
      rotation: [0, 0, 0, 1],
      fov: 50,
    });
    useDirectorStore.getState().recordCameraNode("cam_1", {
      position: [1, 1.55, 4.4],
      rotation: [0, 0, 0, 1],
      fov: 50,
    });
  }

  it("applies an explicit zero hold while preserving omitted duration and rebuilding node time", () => {
    recordTwoNodes();
    const segmentId = useDirectorStore.getState().project.cameras[0]?.segments?.[0]?.id;

    expect(segmentId).toBeTruthy();
    useDirectorStore.getState().updateCameraSegment("cam_1", segmentId!, { holdAfter: 0.5 });
    useDirectorStore.getState().updateCameraSegment("cam_1", segmentId!, { holdAfter: 0 });

    const camera = useDirectorStore.getState().project.cameras[0]!;
    expect(camera.segments?.[0]).toMatchObject({ duration: 1, holdAfter: 0 });
    expect(camera.nodes?.map((node) => node.time)).toEqual([0, 1]);

    useDirectorStore.getState().undo();

    const undoneCamera = useDirectorStore.getState().project.cameras[0]!;
    expect(undoneCamera.segments?.[0]).toMatchObject({ duration: 1, holdAfter: 0.5 });
    expect(undoneCamera.nodes?.map((node) => node.time)).toEqual([0, 1.5]);
  });

  it("clamps an explicit zero duration instead of treating it as omitted", () => {
    recordTwoNodes();
    const segmentId = useDirectorStore.getState().project.cameras[0]?.segments?.[0]?.id;

    expect(segmentId).toBeTruthy();
    useDirectorStore.getState().updateCameraSegment("cam_1", segmentId!, { holdAfter: 0.5 });
    useDirectorStore.getState().updateCameraSegment("cam_1", segmentId!, { duration: 0 });

    const camera = useDirectorStore.getState().project.cameras[0]!;
    expect(camera.segments?.[0]?.duration).toBe(MIN_SEGMENT_DURATION);
    expect(camera.segments?.[0]?.holdAfter).toBe(0.5);
    expect(camera.nodes?.map((node) => node.time)).toEqual([0, MIN_SEGMENT_DURATION + 0.5]);

    useDirectorStore.getState().undo();

    const undoneCamera = useDirectorStore.getState().project.cameras[0]!;
    expect(undoneCamera.segments?.[0]).toMatchObject({ duration: 1, holdAfter: 0.5 });
    expect(undoneCamera.nodes?.map((node) => node.time)).toEqual([0, 1.5]);
  });
});
