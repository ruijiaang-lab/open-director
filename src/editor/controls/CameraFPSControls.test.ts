import { Euler, Quaternion, Vector3 } from "three";
import { FPS_BASE_SPEED, FPS_BOOST_MULTIPLIER, computeFPSMovement, type FPSMovementKeys } from "./CameraFPSControls";

const NO_KEYS: FPSMovementKeys = { forward: false, back: false, left: false, right: false, up: false, down: false };
const IDENTITY = new Quaternion();

function keys(patch: Partial<FPSMovementKeys>): FPSMovementKeys {
  return { ...NO_KEYS, ...patch };
}

function expectCloseTo(received: Vector3, expected: [number, number, number]) {
  expect(received.x).toBeCloseTo(expected[0], 5);
  expect(received.y).toBeCloseTo(expected[1], 5);
  expect(received.z).toBeCloseTo(expected[2], 5);
}

it("moves forward along the camera local -Z axis at base speed", () => {
  const next = computeFPSMovement(new Vector3(0, 0, 0), IDENTITY, keys({ forward: true }), 1, false);
  expectCloseTo(next, [0, 0, -FPS_BASE_SPEED]);
});

it("moves backward along +Z", () => {
  const next = computeFPSMovement(new Vector3(0, 0, 0), IDENTITY, keys({ back: true }), 1, false);
  expectCloseTo(next, [0, 0, FPS_BASE_SPEED]);
});

it("moves left / right along the camera local X axis", () => {
  const left = computeFPSMovement(new Vector3(0, 0, 0), IDENTITY, keys({ left: true }), 1, false);
  const right = computeFPSMovement(new Vector3(0, 0, 0), IDENTITY, keys({ right: true }), 1, false);
  expectCloseTo(left, [-FPS_BASE_SPEED, 0, 0]);
  expectCloseTo(right, [FPS_BASE_SPEED, 0, 0]);
});

it("moves up / down along the world Y axis", () => {
  const up = computeFPSMovement(new Vector3(0, 0, 0), IDENTITY, keys({ up: true }), 1, false);
  const down = computeFPSMovement(new Vector3(0, 0, 0), IDENTITY, keys({ down: true }), 1, false);
  expectCloseTo(up, [0, FPS_BASE_SPEED, 0]);
  expectCloseTo(down, [0, -FPS_BASE_SPEED, 0]);
});

it("multiplies speed when boosting", () => {
  const next = computeFPSMovement(new Vector3(0, 0, 0), IDENTITY, keys({ forward: true }), 1, true);
  expectCloseTo(next, [0, 0, -FPS_BASE_SPEED * FPS_BOOST_MULTIPLIER]);
});

it("scales displacement by delta seconds", () => {
  const next = computeFPSMovement(new Vector3(0, 0, 0), IDENTITY, keys({ forward: true }), 0.5, false);
  expectCloseTo(next, [0, 0, -FPS_BASE_SPEED * 0.5]);
});

it("moves along the camera orientation after a 90° yaw", () => {
  const yawed = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0));
  const next = computeFPSMovement(new Vector3(0, 0, 0), yawed, keys({ forward: true }), 1, false);
  expectCloseTo(next, [-FPS_BASE_SPEED, 0, 0]);
});

it("normalizes diagonal movement so combined keys do not move faster", () => {
  const next = computeFPSMovement(new Vector3(0, 0, 0), IDENTITY, keys({ forward: true, right: true }), 1, false);
  const diagonal = FPS_BASE_SPEED / Math.SQRT2;
  expectCloseTo(next, [diagonal, 0, -diagonal]);
});

it("returns the same position when no movement key is pressed", () => {
  const start = new Vector3(1, 2, 3);
  const next = computeFPSMovement(start, IDENTITY, NO_KEYS, 1, false);
  expect(next).toEqual(start);
});
