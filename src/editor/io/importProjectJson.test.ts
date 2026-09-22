import { expect, it } from "vitest";
import type { DirectorProject, DirectorTransform } from "../schema/directorProject";
import { parseProject } from "./importProjectJson";
import { validateDirectorProject } from "./projectValidation";

function transform(): DirectorTransform {
  return {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

function makeValidProject(): DirectorProject {
  return {
    version: 1,
    scene: {
      scale: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      backgroundColor: "#000000",
      panoramaYaw: 0,
      panoramaRadius: 60,
      showLabels: true,
      snapToGrid: false,
      showGround: true,
      groundOpacity: 0.4,
      groundHeight: 0,
    },
    assets: [
      {
        id: "asset-model",
        kind: "prop",
        sourceType: "model",
        fileName: "chair.glb",
        name: "Chair",
        url: "blob:chair",
        assetSource: "local",
      },
      {
        id: "asset-panorama",
        kind: "panorama",
        sourceType: "image",
        fileName: "studio.jpg",
        name: "Studio",
        url: "data:image/jpeg;base64,studio",
        projectionMode: "equirectangular",
      },
    ],
    objects: [
      {
        id: "object-prop",
        name: "Chair",
        kind: "prop",
        visible: true,
        locked: false,
        assetRefId: "asset-model",
        transform: transform(),
      },
      {
        id: "object-camera",
        name: "Camera",
        kind: "camera",
        visible: true,
        locked: false,
        linkedCameraId: "camera-1",
        transform: transform(),
      },
    ],
    cameras: [
      {
        id: "camera-1",
        name: "Camera",
        fov: 50,
        transform: transform(),
        targetMode: "manual",
        target: [0, 0, 0],
        lastCaptureUrl: null,
        captures: [
          {
            id: "capture-1",
            index: 1,
            name: "Camera capture",
            dataUrl: "data:image/png;base64,capture",
          },
        ],
        nodes: [
          {
            id: "node-1",
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            fov: 50,
            time: 0,
          },
          {
            id: "node-2",
            position: [1, 0, 0],
            rotation: [0, 0, 0, 1],
            fov: 50,
            time: 1,
          },
        ],
        segments: [
          {
            id: "segment-1",
            fromNodeId: "node-1",
            toNodeId: "node-2",
            curveMode: "linear",
            duration: 1,
            holdAfter: 0,
            easing: "linear",
          },
        ],
      },
    ],
    activeCameraId: "camera-1",
    panoramaAssetId: "asset-panorama",
  };
}

function addCharacterWithControls(project: DirectorProject, controls: Record<string, number>) {
  project.objects.push({
    id: "object-character",
    name: "Character",
    kind: "character",
    visible: true,
    locked: false,
    transform: transform(),
    characterRig: {
      rigType: "ue4-mannequin",
      posePresetId: "stand",
      controls,
    },
  });
}

it("turns malformed JSON into the stable user-facing format error", () => {
  expect(() => parseProject("{not-json")).toThrow("工程 JSON 格式错误");
});

it("rejects an unsupported project version with a path-aware error", () => {
  const project = { ...makeValidProject(), version: 2 } as unknown;

  expect(() => validateDirectorProject(project)).toThrow(/version/);
});

it("rejects non-finite transform values with the exact field path", () => {
  const project = makeValidProject();
  project.cameras[0]!.transform.position[1] = Number.POSITIVE_INFINITY;

  expect(() => validateDirectorProject(project)).toThrow("cameras[0].transform.position[1]");
});

it("rejects duplicate IDs within each resource namespace", () => {
  const project = makeValidProject();
  project.assets[1]!.id = project.assets[0]!.id;

  expect(() => validateDirectorProject(project)).toThrow(/assets\[1\]\.id.*(duplicate|重复)/i);
});

it("rejects broken active camera and panorama references", () => {
  const project = makeValidProject();
  project.activeCameraId = "camera-missing";

  expect(() => validateDirectorProject(project)).toThrow("activeCameraId");

  project.activeCameraId = "camera-1";
  project.panoramaAssetId = "asset-model";

  expect(() => validateDirectorProject(project)).toThrow("panoramaAssetId");
});

it("rejects broken object asset and linked camera references", () => {
  const project = makeValidProject();
  project.objects[0]!.assetRefId = "asset-missing";

  expect(() => validateDirectorProject(project)).toThrow("objects[0].assetRefId");

  project.objects[0]!.assetRefId = "asset-model";
  project.objects[1]!.linkedCameraId = "camera-missing";

  expect(() => validateDirectorProject(project)).toThrow("objects[1].linkedCameraId");
});

it("rejects invalid camera target and path node references", () => {
  const project = makeValidProject();
  project.cameras[0]!.targetMode = "object";
  project.cameras[0]!.targetObjectId = "object-missing";

  expect(() => validateDirectorProject(project)).toThrow("cameras[0].targetObjectId");

  project.cameras[0]!.targetObjectId = "object-prop";
  project.cameras[0]!.segments![0]!.toNodeId = "node-missing";

  expect(() => validateDirectorProject(project)).toThrow("cameras[0].segments[0].toNodeId");
});

it("rejects a camera object as an object-mode camera target", () => {
  const project = makeValidProject();
  project.cameras[0]!.targetMode = "object";
  project.cameras[0]!.targetObjectId = "object-camera";

  expect(() => validateDirectorProject(project)).toThrow(/cameras\[0\]\.targetObjectId.*camera/i);
});

it("rejects a panorama object as an object-mode camera target", () => {
  const project = makeValidProject();
  project.objects.push({
    ...project.objects[0]!,
    id: "object-panorama",
    name: "Panorama",
    kind: "panorama",
    assetRefId: "asset-panorama",
  });
  project.cameras[0]!.targetMode = "object";
  project.cameras[0]!.targetObjectId = "object-panorama";

  expect(() => validateDirectorProject(project)).toThrow(/cameras\[0\]\.targetObjectId.*panorama/i);
});

it("requires manual camera targets to be null or a compatible 3D object, regardless of visibility", () => {
  const project = makeValidProject();
  project.cameras[0]!.targetMode = "manual";
  project.cameras[0]!.targetObjectId = "object-camera";

  expect(() => validateDirectorProject(project)).toThrow(/cameras\[0\]\.targetObjectId.*camera/i);

  project.cameras[0]!.targetObjectId = null;
  expect(validateDirectorProject(project)).toEqual(project);

  project.cameras[0]!.targetObjectId = "object-prop";
  project.objects[0]!.visible = false;
  expect(validateDirectorProject(project)).toEqual(project);
});

it("accepts a valid legacy v1 project with migration-owned optional fields absent", () => {
  const project = makeValidProject();
  delete project.objects[0]!.characterRig;
  delete project.cameras[0]!.nodes;
  delete project.cameras[0]!.segments;
  delete project.cameras[0]!.captures;

  expect(validateDirectorProject(project)).toEqual(project);
});

it("returns a fully validated project from JSON", () => {
  const project = makeValidProject();

  expect(parseProject(JSON.stringify(project))).toEqual(project);
});

it("rejects a sparse scene vector with a path-aware error", () => {
  const project = makeValidProject();
  Reflect.deleteProperty(project.scene.position, 1);

  expect(() => validateDirectorProject(project)).toThrow("scene.position[1]");
});

it("rejects a sparse top-level assets array with a path-aware error", () => {
  const project = makeValidProject();
  Reflect.deleteProperty(project.assets, 0);

  expect(() => validateDirectorProject(project)).toThrow("assets[0]");
});

it("rejects sparse capture, node, and segment arrays with their own paths", () => {
  const capturesProject = makeValidProject();
  Reflect.deleteProperty(capturesProject.cameras[0]!.captures!, 0);
  expect(() => validateDirectorProject(capturesProject)).toThrow("cameras[0].captures[0]");

  const nodesProject = makeValidProject();
  Reflect.deleteProperty(nodesProject.cameras[0]!.nodes!, 0);
  expect(() => validateDirectorProject(nodesProject)).toThrow("cameras[0].nodes[0]");

  const segmentsProject = makeValidProject();
  Reflect.deleteProperty(segmentsProject.cameras[0]!.segments!, 0);
  expect(() => validateDirectorProject(segmentsProject)).toThrow("cameras[0].segments[0]");
});

it("rejects inherited schema fields instead of accepting them as own data", () => {
  const project = makeValidProject();
    const inheritedScene = Object.create({ scale: project.scene.scale }) as DirectorProject["scene"];
  Object.assign(inheritedScene, project.scene);
  Reflect.deleteProperty(inheritedScene, "scale");
  project.scene = inheritedScene;

  expect(() => validateDirectorProject(project)).toThrow(/scene.*(plain|own|对象|自有)/i);
});

it.each(["__proto__", "constructor", "prototype"])(
  "rejects special rig control key %s without silently dropping it",
  (key) => {
    const project = makeValidProject();
    const controls = JSON.parse(`{"${key}":1}`) as Record<string, number>;
    addCharacterWithControls(project, controls);

    expect(() => validateDirectorProject(project)).toThrow(`objects[2].characterRig.controls.${key}`);
  }
);
