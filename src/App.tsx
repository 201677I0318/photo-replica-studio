import { useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock3,
  FileImage,
  History,
  Images,
  LoaderCircle,
  Play,
  Printer,
  Sparkles,
  StopCircle,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { AnalysisMode, AnalysisResponse } from "../shared/report";
import { blobToFile, deleteAnalysis, listAnalyses, saveAnalysis, type SavedAnalysis } from "./history";
import { ReportView } from "./ReportView";

interface ApiStatus {
  configured: boolean;
  model: string;
  apiMode: string;
}

interface ProgressState {
  value: number;
  message: string;
  detail: string;
}

interface StreamEvent {
  type: "progress" | "heartbeat" | "result" | "error";
  progress?: number;
  message?: string;
  detail?: string;
  elapsedMs?: number;
  data?: AnalysisResponse;
  error?: string;
}

interface ActivityItem {
  message: string;
  detail: string;
  elapsedMs: number;
}

function FileDrop({
  file,
  label,
  hint,
  required,
  onChange,
}: {
  file: File | null;
  label: string;
  hint: string;
  required?: boolean;
  onChange: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const acceptFile = (candidate?: File) => {
    if (candidate?.type.startsWith("image/")) onChange(candidate);
  };

  return (
    <div className="file-field">
      <div className="field-heading">
        <div>
          <span className="field-label">{label}</span>
          {required && <span className="required-mark">必需</span>}
        </div>
        <span>{hint}</span>
      </div>
      <button
        type="button"
        className={`drop-zone ${file ? "has-file" : ""} ${dragging ? "is-dragging" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          acceptFile(event.dataTransfer.files[0]);
        }}
      >
        {previewUrl ? (
          <>
            <img src={previewUrl} alt={`${label}预览`} />
            <span className="image-shade" />
            <span className="file-meta">
              <FileImage size={18} />
              <span>
                <strong>{file?.name}</strong>
                <small>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : ""}</small>
              </span>
            </span>
            <span
              role="button"
              tabIndex={0}
              className="remove-file"
              title="移除照片"
              onClick={(event) => {
                event.stopPropagation();
                onChange(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onChange(null);
              }}
            >
              <X size={18} />
            </span>
          </>
        ) : (
          <span className="empty-drop">
            <span className="upload-icon"><Upload size={22} /></span>
            <strong>拖入照片或点击选择</strong>
            <small>JPG、PNG、WEBP · 单张不超过 20 MB</small>
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={(event) => acceptFile(event.target.files?.[0])}
      />
    </div>
  );
}

const progressStages = [
  { label: "上传照片", threshold: 10 },
  { label: "识别画面", threshold: 30 },
  { label: "生成方案", threshold: 90 },
  { label: "校验报告", threshold: 100 },
];

function formatElapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatSavedAt(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function HistoryThumbnail({ image, label }: { image?: Blob; label: string }) {
  const url = useMemo(() => image ? URL.createObjectURL(image) : null, [image]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url ? <img src={url} alt={label} /> : <span><FileImage size={20} /></span>;
}

export default function App() {
  const [mode, setMode] = useState<AnalysisMode>("reference");
  const [reference, setReference] = useState<File | null>(null);
  const [current, setCurrent] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressState>({ value: 0, message: "", detail: "" });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<SavedAnalysis[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const requestStartedAt = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/status").then((response) => response.json()).then(setStatus).catch(() => setStatus(null));
    listAnalyses()
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setHistoryReady(true));
  }, []);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => setElapsedMs(Date.now() - requestStartedAt.current), 1000);
    return () => window.clearInterval(timer);
  }, [loading]);

  async function analyze() {
    if (!reference) {
      setError("请先上传参考照片。 ");
      return;
    }
    if (mode === "compare" && !current) {
      setError("对比分析需要再上传一张用户成片。 ");
      return;
    }

    const form = new FormData();
    form.append("mode", mode);
    form.append("reference", reference);
    if (current) form.append("current", current);
    form.append("note", note);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    requestStartedAt.current = Date.now();
    setLoading(true);
    setElapsedMs(0);
    setProgress({ value: 4, message: "正在上传照片", detail: "准备发送原始图像" });
    setActivity([{ message: "开始分析", detail: "正在上传照片", elapsedMs: 0 }]);
    setError("");
    try {
      const response = await fetch("/api/analyze-stream", {
        method: "POST",
        body: form,
        signal: abortController.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || `分析请求失败（${response.status}）`);
      }
      if (!response.body) throw new Error("当前浏览器不支持流式分析响应。");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completedResult: AnalysisResponse | null = null;
      let lastActivityMessage = "开始分析";

      const processLine = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as StreamEvent;
        if (event.type === "error") throw new Error(event.error || "分析失败，请稍后重试。");
        if (event.type === "result" && event.data) {
          completedResult = event.data;
          setProgress({ value: 100, message: "分析完成", detail: "报告已生成" });
          return;
        }
        if ((event.type === "progress" || event.type === "heartbeat") && event.message) {
          setProgress((previous) => ({
            value: Math.max(previous.value, event.progress || previous.value),
            message: event.message || previous.message,
            detail: event.detail || previous.detail,
          }));
          if (typeof event.elapsedMs === "number") setElapsedMs(event.elapsedMs);
          if (event.type === "progress" && event.message !== lastActivityMessage) {
            lastActivityMessage = event.message;
            setActivity((items) => [...items.slice(-4), {
              message: event.message || "继续分析",
              detail: event.detail || "",
              elapsedMs: event.elapsedMs || Date.now() - requestStartedAt.current,
            }]);
          }
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        lines.forEach(processLine);
        if (done) break;
      }
      if (buffer.trim()) processLine(buffer);
      if (!completedResult) throw new Error("连接已结束，但没有收到完整报告。");

      setResult(completedResult);
      try {
        await saveAnalysis({ response: completedResult, mode, note, reference, current });
        setHistory(await listAnalyses());
      } catch (saveError) {
        console.error("保存分析历史失败", saveError);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") {
        setError("分析已取消，可以调整说明后重新开始。");
      } else {
        setError(requestError instanceof Error ? requestError.message : "分析失败，请稍后重试。");
      }
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  }

  async function loadDemo() {
    requestStartedAt.current = Date.now();
    setLoading(true);
    setElapsedMs(0);
    setProgress({ value: 45, message: "正在载入演示报告", detail: "准备示例参数" });
    setActivity([]);
    setError("");
    try {
      const response = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      setResult(await response.json());
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("演示报告加载失败，请确认本地服务已启动。");
    } finally {
      setLoading(false);
    }
  }

  const newAnalysis = () => {
    setResult(null);
    setError("");
  };

  const openSavedAnalysis = (record: SavedAnalysis) => {
    setMode(record.mode);
    setNote(record.note);
    setReference(blobToFile(record.reference, "历史参考图.jpg"));
    setCurrent(blobToFile(record.current, "历史成片.jpg"));
    setResult(record.response);
    setHistoryOpen(false);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const removeSavedAnalysis = async (id: string) => {
    await deleteAnalysis(id);
    setHistory((items) => items.filter((item) => item.id !== id));
    if (result?.requestId === id) newAnalysis();
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="仿拍工作台首页" onClick={newAnalysis}>
          <span className="brand-mark"><Aperture size={20} /></span>
          <span>仿拍工作台</span>
          <span className="version">MVP</span>
        </a>
        <div className="topbar-actions">
          {status && (
            <span className={`api-status ${status.configured ? "online" : "offline"}`} title={`${status.apiMode} · ${status.model}`}>
              <i />{status.configured ? "API 已连接" : "演示模式"}
            </span>
          )}
          <button type="button" className="button ghost compact history-trigger" onClick={() => setHistoryOpen(true)}>
            <History size={17} />历史记录{history.length > 0 && <b>{history.length}</b>}
          </button>
          {result && (
            <>
              <button type="button" className="button ghost compact" onClick={newAnalysis}><ArrowLeft size={17} />新分析</button>
              <button type="button" className="button ghost compact" onClick={() => window.print()}><Printer size={17} />打印报告</button>
            </>
          )}
        </div>
      </header>

      {result ? (
        <ReportView response={result} reference={reference} current={current} />
      ) : (
        <main className="workspace" id="top">
          <section className="workspace-intro">
            <div>
              <span className="eyebrow">PHOTO REVERSE ENGINEERING</span>
              <h1>把参考照片拆成可执行方案</h1>
              <p>上传照片，获得构图、光影、服饰或风光条件分析，以及像素蛋糕和 Photoshop 的具体参数。</p>
            </div>
            <div className="process-strip" aria-label="分析流程">
              <span><b>01</b> 上传参考</span><i />
              <span><b>02</b> 视觉拆解</span><i />
              <span><b>03</b> 拍摄与后期</span>
            </div>
          </section>

          <section className="analysis-panel">
            <div className="panel-head">
              <div>
                <h2>新建分析</h2>
                <p>先选择任务类型，再添加清晰的原图。</p>
              </div>
              <div className="segmented" role="group" aria-label="分析模式">
                <button type="button" className={mode === "reference" ? "active" : ""} onClick={() => setMode("reference")}>
                  <FileImage size={16} />参考图拆解
                </button>
                <button type="button" className={mode === "compare" ? "active" : ""} onClick={() => setMode("compare")}>
                  <Images size={16} />成片对比
                </button>
              </div>
            </div>

            <div className={`upload-grid ${mode === "reference" ? "single" : ""}`}>
              <FileDrop file={reference} label="参考照片" hint="系统将拆解这张照片" required onChange={setReference} />
              {mode === "compare" && (
                <FileDrop file={current} label="用户成片" hint="与参考图逐项比较" required onChange={setCurrent} />
              )}
            </div>

            <div className="note-field">
              <label htmlFor="note">补充说明 <span>选填</span></label>
              <textarea
                id="note"
                maxLength={1000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="例如：主要用手机拍摄；地点在室外；希望重点分析天空和前景层次……"
              />
              <small>{note.length}/1000</small>
            </div>

            {error && <div className="error-banner" role="alert"><X size={18} /><span>{error}</span></div>}

            <div className="panel-footer">
              <p><Check size={15} />报告和压缩预览会自动保存在当前浏览器，可从历史记录恢复。</p>
              <div className="action-row">
                <button type="button" className="button ghost" onClick={loadDemo} disabled={loading}><Play size={17} />查看示例</button>
                <button type="button" className="button primary" onClick={analyze} disabled={loading}>
                  {loading ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}
                  {loading ? "分析中" : "开始分析"}
                </button>
              </div>
            </div>
          </section>

          <section className="scope-row" aria-label="分析能力">
            <article><span>01</span><strong>人像</strong><p>光位、姿态、服饰、妆发与肤色</p></article>
            <article><span>02</span><strong>风光</strong><p>天气、时段、景深、滤镜与地形层次</p></article>
            <article><span>03</span><strong>后期</strong><p>像素蛋糕、Camera Raw 与 Photoshop</p></article>
          </section>
        </main>
      )}

      {historyOpen && (
        <div className="history-layer" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setHistoryOpen(false);
        }}>
          <aside className="history-drawer" aria-label="分析历史">
            <div className="history-head">
              <div><span>LOCAL ARCHIVE</span><h2>分析历史</h2><p>保存在当前浏览器，不会上传到服务端。</p></div>
              <button type="button" className="icon-button" title="关闭历史记录" onClick={() => setHistoryOpen(false)}><X size={20} /></button>
            </div>
            <div className="history-list">
              {!historyReady && <div className="history-empty"><LoaderCircle className="spin" size={24} /><span>正在读取历史记录</span></div>}
              {historyReady && history.length === 0 && <div className="history-empty"><History size={28} /><strong>还没有分析记录</strong><span>完成一次真实照片分析后会自动出现在这里。</span></div>}
              {history.map((record) => (
                <article className="history-item" key={record.id}>
                  <button type="button" className="history-open" onClick={() => openSavedAnalysis(record)}>
                    <span className="history-thumb"><HistoryThumbnail image={record.reference} label={record.response.report.meta.title} /></span>
                    <span className="history-copy">
                      <strong>{record.response.report.meta.title}</strong>
                      <small>{record.response.report.meta.sceneTypeLabel} · {formatSavedAt(record.savedAt)}</small>
                      <span>{record.response.model}</span>
                    </span>
                  </button>
                  <button type="button" className="history-delete" title="删除记录" onClick={() => void removeSavedAnalysis(record.id)}><Trash2 size={16} /></button>
                </article>
              ))}
            </div>
          </aside>
        </div>
      )}

      {loading && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="loading-dialog">
            <div className="loading-head">
              <span className="loader-aperture"><Aperture size={30} /></span>
              <span className="elapsed"><Clock3 size={14} />已用 {formatElapsed(elapsedMs)}</span>
            </div>
            <strong>{progress.message}</strong>
            <p>{progress.detail}</p>
            <div className="progress-meta"><span>分析进度</span><b>{Math.round(progress.value)}%</b></div>
            <div className="loading-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.value)}>
              <span style={{ width: `${progress.value}%` }} />
            </div>
            <div className="progress-stages">
              {progressStages.map((stage, index) => {
                const completed = progress.value >= stage.threshold;
                const active = !completed && (index === 0 || progress.value >= progressStages[index - 1].threshold);
                return (
                  <span key={stage.label} className={completed ? "done" : active ? "active" : ""}>
                    {completed ? <CheckCircle2 size={14} /> : <i />}{stage.label}
                  </span>
                );
              })}
            </div>
            {activity.length > 0 && (
              <div className="activity-log" aria-label="分析动态">
                {activity.map((item, index) => (
                  <div key={`${item.elapsedMs}-${index}`}>
                    <time>{formatElapsed(item.elapsedMs)}</time>
                    <span><strong>{item.message}</strong><small>{item.detail}</small></span>
                  </div>
                ))}
              </div>
            )}
            <button type="button" className="cancel-analysis" onClick={() => abortControllerRef.current?.abort()}>
              <StopCircle size={16} />取消分析
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
