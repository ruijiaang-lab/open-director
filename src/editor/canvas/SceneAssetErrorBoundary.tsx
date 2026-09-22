import { Html, Line } from "@react-three/drei";
import { Component, type ErrorInfo, type ReactNode } from "react";

type SceneAssetErrorBoundaryProps = {
  children: ReactNode;
  fileName: string;
  resetKey: string;
};

type SceneAssetErrorBoundaryState = {
  hasError: boolean;
};

type WireframePoint = [number, number, number];

const ERROR_WIREFRAME_LINES: WireframePoint[][] = [
  [
    [-0.72, 0, -0.72],
    [0.72, 0, -0.72],
    [0.72, 1.44, -0.72],
    [-0.72, 1.44, -0.72],
    [-0.72, 0, -0.72],
  ],
  [
    [-0.72, 0, 0.72],
    [0.72, 0, 0.72],
    [0.72, 1.44, 0.72],
    [-0.72, 1.44, 0.72],
    [-0.72, 0, 0.72],
  ],
  [[-0.72, 0, -0.72], [-0.72, 0, 0.72]],
  [[0.72, 0, -0.72], [0.72, 0, 0.72]],
  [[0.72, 1.44, -0.72], [0.72, 1.44, 0.72]],
  [[-0.72, 1.44, -0.72], [-0.72, 1.44, 0.72]],
];

export class SceneAssetErrorBoundary extends Component<
  SceneAssetErrorBoundaryProps,
  SceneAssetErrorBoundaryState
> {
  state: SceneAssetErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): SceneAssetErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // Keep the viewport fallback local; callers can add centralized reporting without unmounting the scene.
  }

  componentDidUpdate(previousProps: SceneAssetErrorBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <group name="scene-asset-error-placeholder">
        {ERROR_WIREFRAME_LINES.map((points, index) => (
          <Line
            key={`scene-asset-error-wireframe-${index}`}
            color="#E0524D"
            lineWidth={2}
            name={`scene-asset-error-wireframe-${index}`}
            points={points}
          />
        ))}
        <Html center position={[0, 1.7, 0]} pointerEvents="none" sprite transform>
          <div className="scene-asset-error-label" role="alert">
            {this.props.fileName} 加载失败
          </div>
        </Html>
      </group>
    );
  }
}
