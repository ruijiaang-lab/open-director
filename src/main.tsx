import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// DEV-only：暴露 store 供浏览器自动化验收脚本读取/驱动（生产构建不包含）
if (import.meta.env.DEV) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__directorStore = import("./editor/store/directorStore").then(
    (module) => module.useDirectorStore
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__playbackStore = import("./editor/store/cameraPlaybackStore").then(
    (module) => module.useCameraPlaybackStore
  );
}
