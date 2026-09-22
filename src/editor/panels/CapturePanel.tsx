import { useEffect, useRef, useState } from "react";
import { requestViewportCapture } from "../io/captureBridge";
import { serializeProject } from "../io/exportProjectJson";
import { parseProject } from "../io/importProjectJson";
import { downloadCaptureResults } from "../io/screenshotExport";
import { useDirectorStore } from "../store/directorStore";
import { InspectorSection } from "./InspectorControls";

export function CapturePanel({ embedded = false }: { embedded?: boolean }) {
  const [captureStatus, setCaptureStatus] = useState<string | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const captureBusyRef = useRef(false);
  const captureEpochRef = useRef(0);
  const importEpochRef = useRef(0);
  const project = useDirectorStore((state) => state.project);
  const replaceProject = useDirectorStore((state) => state.replaceProject);
  const saveLatestSnapshot = useDirectorStore((state) => state.saveLatestSnapshot);
  const restoreLatestSnapshot = useDirectorStore((state) => state.restoreLatestSnapshot);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      captureBusyRef.current = false;
      captureEpochRef.current += 1;
      importEpochRef.current += 1;
    };
  }, []);

  async function handleCapture(preset: "current" | "four" | "twelve") {
    if (!mountedRef.current || captureBusyRef.current) return;

    captureBusyRef.current = true;
    const requestEpoch = ++captureEpochRef.current;
    setCaptureBusy(true);
    setCaptureStatus(null);

    try {
      const results = await requestViewportCapture({
        preset,
        source: "capture-panel",
      });

      if (!mountedRef.current || captureEpochRef.current !== requestEpoch) return;

      const count = downloadCaptureResults(results);
      setCaptureStatus(`已导出 ${count} 张截图`);
    } catch (error) {
      if (!mountedRef.current || captureEpochRef.current !== requestEpoch) return;

      setCaptureStatus(error instanceof Error ? error.message : "截图失败");
    } finally {
      if (mountedRef.current && captureEpochRef.current === requestEpoch) {
        captureBusyRef.current = false;
        setCaptureBusy(false);
      }
    }
  }

  async function handleProjectImport(file: File, requestEpoch: number) {
    try {
      const nextProject = parseProject(await file.text());

      if (!mountedRef.current || importEpochRef.current !== requestEpoch) return;

      replaceProject(nextProject);
      setImportError(null);
      setImportStatus("工程导入成功");
    } catch (error) {
      if (!mountedRef.current || importEpochRef.current !== requestEpoch) return;

      setImportStatus(null);
      setImportError(error instanceof Error ? error.message : "工程导入失败");
    }
  }

  function handleProjectExport() {
    const blob = new Blob([serializeProject(project)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "open-director-project.json";
    anchor.rel = "noopener";

    try {
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const content = (
    <>
      <InspectorSection title="截图">
        <div aria-busy={captureBusy} className="capture-controls">
          <button
            className="capture-action"
            type="button"
            disabled={captureBusy}
            onClick={() => void handleCapture("current")}
          >
            当前视角截图
          </button>
          <button
            className="capture-action"
            type="button"
            disabled={captureBusy}
            onClick={() => void handleCapture("four")}
          >
            四方位截图
          </button>
          <button
            className="capture-action"
            type="button"
            disabled={captureBusy}
            onClick={() => void handleCapture("twelve")}
          >
            十二方位截图
          </button>
          {captureBusy ? (
            <p aria-live="polite" className="capture-status" role="status">
              处理中
            </p>
          ) : captureStatus ? (
            <p aria-live="polite" className="capture-status" role="status">
              {captureStatus}
            </p>
          ) : null}
        </div>
      </InspectorSection>
      <InspectorSection title="工程">
        <button className="capture-action" type="button" onClick={handleProjectExport}>
          导出工程 JSON
        </button>
        <input
          ref={fileInputRef}
          className="ui-field"
          aria-label="导入工程 JSON"
          accept="application/json"
          type="file"
          onChange={(event) => {
            const requestEpoch = ++importEpochRef.current;
            const file = event.currentTarget.files?.[0];
            setImportError(null);
            setImportStatus(null);
            event.currentTarget.value = "";
            if (!file) {
              return;
            }
            void handleProjectImport(file, requestEpoch);
          }}
        />
        {importError ? (
          <p aria-live="assertive" className="capture-status" role="alert">
            {importError}
          </p>
        ) : null}
        {importStatus ? (
          <p aria-live="polite" className="capture-status" role="status">
            {importStatus}
          </p>
        ) : null}
        <button className="capture-action" type="button" onClick={saveLatestSnapshot}>
          保存最近工程
        </button>
        <button className="capture-action" type="button" onClick={restoreLatestSnapshot}>
          恢复最近工程
        </button>
      </InspectorSection>
    </>
  );

  return embedded ? content : <section className="panel-card capture-panel">{content}</section>;
}
