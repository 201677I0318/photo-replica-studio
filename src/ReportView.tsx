import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  CircleDot,
  CloudSun,
  Copy,
  Download,
  GitCompareArrows,
  Image,
  Lightbulb,
  LoaderCircle,
  Palette,
  RectangleHorizontal,
  RectangleVertical,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Square,
  SunMedium,
  UserRound,
  WandSparkles,
} from "lucide-react";
import type { AiImageAdvice, AnalysisResponse, PhotoReport } from "../shared/report";
import { downloadXmp } from "./xmp";

type TabId = "overview" | "capture" | "color" | "post" | "ai" | "compare";

const tabs: Array<{ id: TabId; label: string; icon: typeof Camera }> = [
  { id: "overview", label: "分析总览", icon: Sparkles },
  { id: "capture", label: "拍摄方案", icon: Camera },
  { id: "color", label: "色彩与风格", icon: Palette },
  { id: "post", label: "后期参数", icon: SlidersHorizontal },
  { id: "ai", label: "AI 修图", icon: WandSparkles },
  { id: "compare", label: "差异对比", icon: GitCompareArrows },
];

type ImageSize = "1024x1536" | "1536x1024" | "1024x1024";
type ImageQuality = "low" | "medium" | "high";

interface GeneratedImage {
  imageDataUrl: string;
  model: string;
  size: ImageSize;
  quality: ImageQuality;
}

function fallbackAiAdvice(report: PhotoReport): AiImageAdvice {
  const palette = report.visualSignature.palette.map((color) => `${color.name} ${color.hex}`).join("、");
  return {
    mode: report.comparison.enabled ? "style_transfer" : "style_variation",
    strategy: "这份旧报告生成于 AI 修图功能上线前。以下提示词已根据现有风格、影调和拍摄建议自动补全，可直接编辑后使用。",
    retouchPlan: [
      { target: "光线", instruction: report.capture.lighting.summary, strength: "中等" },
      { target: "色彩影调", instruction: `${report.visualSignature.tone} 主色控制为 ${palette}。`, strength: "中等" },
      { target: "后期质感", instruction: report.visualSignature.mood, strength: "轻微" },
    ],
    prompt: `任务与用途：生成一张具有参考照片摄影语言的真实照片。\n场景与背景：沿用参考图的空间层次与叙事逻辑，但创建原创细节。\n主体：保持自然、真实的人物或场景质感。\n构图与机位：${report.capture.composition.map((item) => item.action).join("；")}\n光线：${report.capture.lighting.summary}\n色彩与影调：${report.visualSignature.tone} 主色为 ${palette}。\n材质与细节：保留皮肤、服饰或自然景物的真实纹理。\n镜头与成像：${report.capture.camera.focalLength}，${report.capture.camera.aspectRatio}，真实摄影观感。\n后期质感：${report.visualSignature.mood}\n必须保持：参考图的光线方向、色彩关系、影调和材质质感。\n硬性约束：不生成文字、标志或水印，不出现多余人物、手指或肢体，不过度磨皮。`,
    preserve: ["光线方向与光质", "色彩关系", "影调结构", "真实材质"],
    constraints: ["不生成文字、标志或水印", "不出现多余人物或肢体", "不过度磨皮"],
  };
}

const cameraLabels: Array<[keyof PhotoReport["capture"]["camera"], string]> = [
  ["device", "设备"],
  ["focalLength", "焦段"],
  ["aperture", "光圈"],
  ["shutter", "快门"],
  ["iso", "感光度"],
  ["whiteBalance", "白平衡"],
  ["focus", "对焦"],
  ["aspectRatio", "画幅"],
];

function Priority({ value }: { value: "高" | "中" | "低" }) {
  return <span className={`priority p-${value}`}>{value}</span>;
}

function ParameterTable({ rows }: { rows: PhotoReport["post"]["pixelCake"] }) {
  return (
    <div className="table-wrap">
      <table className="parameter-table">
        <thead><tr><th>模块</th><th>参数</th><th>建议值</th><th>作用</th></tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.section}-${row.parameter}-${index}`}>
              <td data-label="模块">{row.section}</td>
              <td data-label="参数"><strong>{row.parameter}</strong></td>
              <td data-label="建议值"><code>{row.value}</code></td>
              <td data-label="作用">{row.rationale}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PhotoPreview({ file, label }: { file: File; label: string }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <figure className="report-photo"><img src={url} alt={label} /><figcaption>{label}</figcaption></figure>;
}

function SectionTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div className="section-title">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  );
}

export function ReportView({
  response,
  reference,
  current,
}: {
  response: AnalysisResponse;
  reference: File | null;
  current: File | null;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [exportMessage, setExportMessage] = useState("");
  const report = response.report;
  const aiAdvice = report.post.aiImage || fallbackAiAdvice(report);
  const [aiPrompt, setAiPrompt] = useState(aiAdvice.prompt);
  const [imageSize, setImageSize] = useState<ImageSize>("1024x1536");
  const [imageQuality, setImageQuality] = useState<ImageQuality>("medium");
  const [generatedImage, setGeneratedImage] = useState<GeneratedImage | null>(null);
  const [generationError, setGenerationError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generationElapsed, setGenerationElapsed] = useState(0);
  const [copyMessage, setCopyMessage] = useState("");
  const generationController = useRef<AbortController | null>(null);
  const visibleTabs = tabs.filter((tab) => tab.id !== "compare" || report.comparison.enabled);

  useEffect(() => {
    setAiPrompt(aiAdvice.prompt);
    setGeneratedImage(null);
    setGenerationError("");
  }, [response.requestId]);

  useEffect(() => {
    if (!generating) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setGenerationElapsed(Date.now() - startedAt), 1000);
    return () => window.clearInterval(timer);
  }, [generating]);

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(aiPrompt);
    setCopyMessage("已复制");
    window.setTimeout(() => setCopyMessage(""), 2500);
  };

  const generateImage = async () => {
    if (!reference || response.demo) return;
    const controller = new AbortController();
    generationController.current = controller;
    setGenerating(true);
    setGenerationElapsed(0);
    setGenerationError("");

    try {
      const form = new FormData();
      const isTransfer = aiAdvice.mode === "style_transfer" && Boolean(current);
      form.append("mode", isTransfer ? "compare" : "reference");
      form.append("prompt", aiPrompt);
      form.append("size", imageSize);
      form.append("quality", imageQuality);
      form.append("reference", reference);
      if (isTransfer && current) form.append("current", current);

      const result = await fetch("/api/generate-image", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      const payload = await result.json() as GeneratedImage & { error?: string };
      if (!result.ok) throw new Error(payload.error || "图像生成失败，请稍后重试。");
      setGeneratedImage(payload);
    } catch (error) {
      setGenerationError(error instanceof DOMException && error.name === "AbortError"
        ? "已取消本次生成。"
        : error instanceof Error ? error.message : "图像生成失败，请稍后重试。");
    } finally {
      setGenerating(false);
      generationController.current = null;
    }
  };

  const generationMessage = generationElapsed < 15_000
    ? "素材已提交，正在等待图像模型开始处理"
    : generationElapsed < 60_000
      ? "图像模型正在生成完整画面"
      : "高质量图像需要更多时间，连接仍在等待结果";

  return (
    <main className="report-shell">
      <section className="report-hero">
        <div className="report-hero-inner">
          <div className="report-heading">
            <div className="report-kicker"><span>{report.meta.sceneTypeLabel}</span><i />可信度 {report.meta.confidence}</div>
            <h1>{report.meta.title}</h1>
            <p>{report.meta.summary}</p>
            <div className="keyword-row">
              {report.visualSignature.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}
            </div>
          </div>
          <div className={`report-images ${current ? "two" : ""}`}>
            {reference ? <PhotoPreview file={reference} label="参考图" /> : <div className="demo-photo"><Camera size={32} /><span>演示报告</span></div>}
            {current && <PhotoPreview file={current} label="用户成片" />}
          </div>
        </div>
      </section>

      <nav className="report-tabs" aria-label="报告章节">
        <div>
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} type="button" className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>
                <Icon size={17} />{tab.label}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="report-content">
        <section className={`report-page ${activeTab === "overview" ? "active" : ""}`}>
          <SectionTitle eyebrow="OVERVIEW" title="先抓住决定成败的部分" description="按优先级执行，先还原现场条件，再进入后期。" />
          <div className="overview-grid">
            <div className="action-list">
              {report.capture.checklist.map((item, index) => (
                <article key={`${item.phase}-${index}`}>
                  <span className="action-index">{String(index + 1).padStart(2, "0")}</span>
                  <div><small>{item.phase}</small><strong>{item.item}</strong></div>
                  <Priority value={item.priority} />
                </article>
              ))}
            </div>
            <aside className="signature-panel">
              <h3>画面基因</h3>
              <dl>
                <div><dt>影调</dt><dd>{report.visualSignature.tone}</dd></div>
                <div><dt>情绪</dt><dd>{report.visualSignature.mood}</dd></div>
                <div><dt>风格参照</dt><dd>{report.visualSignature.styleReferences.join(" · ")}</dd></div>
              </dl>
              <div className="mini-palette">
                {report.visualSignature.palette.map((color) => <span key={color.hex} style={{ background: color.hex }} title={`${color.name} ${color.hex}`} />)}
              </div>
            </aside>
          </div>

          {report.comparison.enabled && (
            <div className="comparison-callout">
              <GitCompareArrows size={22} />
              <div><strong>成片差异结论</strong><p>{report.comparison.summary}</p></div>
              <button type="button" onClick={() => setActiveTab("compare")}>查看修正顺序</button>
            </div>
          )}

          <div className="caveat"><Lightbulb size={18} /><span><strong>参数边界</strong>{report.meta.caveat}</span></div>
          <div className="risk-grid">
            {report.risks.map((risk) => (
              <article key={risk.title}><AlertTriangle size={18} /><div><strong>{risk.title}</strong><p>{risk.detail}</p></div></article>
            ))}
          </div>
        </section>

        <section className={`report-page ${activeTab === "capture" ? "active" : ""}`}>
          <SectionTitle eyebrow="CAPTURE PLAN" title="现场拍摄方案" description="相机与手机均可按等效焦段和曝光逻辑执行。" />
          <div className="camera-grid">
            {cameraLabels.map(([key, label]) => <div key={key}><span>{label}</span><strong>{report.capture.camera[key]}</strong></div>)}
          </div>

          <div className="split-section">
            <div>
              <div className="subheading"><CircleDot size={18} /><h3>构图与机位</h3></div>
              <div className="detail-list">
                {report.capture.composition.map((item) => (
                  <article key={item.label}><strong>{item.label}</strong><p>{item.observation}</p><span>{item.action}</span></article>
                ))}
              </div>
            </div>
            <div>
              <div className="subheading"><SunMedium size={19} /><h3>光线搭建</h3></div>
              <div className="lighting-summary"><p>{report.capture.lighting.summary}</p>
                <dl>
                  <div><dt>方向</dt><dd>{report.capture.lighting.direction}</dd></div>
                  <div><dt>光质</dt><dd>{report.capture.lighting.quality}</dd></div>
                  <div><dt>光比</dt><dd>{report.capture.lighting.contrastRatio}</dd></div>
                  <div><dt>时段</dt><dd>{report.capture.lighting.timeWindow}</dd></div>
                </dl>
              </div>
              <ol className="numbered-list">{report.capture.lighting.setupSteps.map((step) => <li key={step}>{step}</li>)}</ol>
            </div>
          </div>

          {report.capture.portrait.applicable && (
            <div className="domain-section">
              <div className="subheading"><UserRound size={19} /><h3>人物造型与表现</h3></div>
              <div className="domain-grid">
                <div><strong>服饰</strong><ul>{report.capture.portrait.wardrobe.map((item) => <li key={item}>{item}</li>)}</ul></div>
                <div><strong>妆发</strong><ul>{report.capture.portrait.makeupHair.map((item) => <li key={item}>{item}</li>)}</ul></div>
                <div><strong>姿态</strong><ul>{report.capture.portrait.pose.map((item) => <li key={item}>{item}</li>)}</ul></div>
                <div><strong>皮肤处理</strong><ul>{report.capture.portrait.skinTreatment.map((item) => <li key={item}>{item}</li>)}</ul></div>
              </div>
            </div>
          )}

          {report.capture.landscape.applicable && (
            <div className="domain-section landscape">
              <div className="subheading"><CloudSun size={20} /><h3>风光现场条件</h3></div>
              <div className="landscape-facts">
                <div><span>天气</span><strong>{report.capture.landscape.weather}</strong></div>
                <div><span>季节</span><strong>{report.capture.landscape.season}</strong></div>
                <div><span>地点条件</span><strong>{report.capture.landscape.location}</strong></div>
                <div><span>拍摄时机</span><strong>{report.capture.landscape.timing}</strong></div>
              </div>
              <div className="domain-grid three">
                <div><strong>滤镜与附件</strong><ul>{report.capture.landscape.filters.map((item) => <li key={item}>{item}</li>)}</ul></div>
                <div><strong>景深与层次</strong><ul>{report.capture.landscape.depthPlan.map((item) => <li key={item}>{item}</li>)}</ul></div>
                <div><strong>现场清单</strong><ul>{report.capture.landscape.fieldChecklist.map((item) => <li key={item}>{item}</li>)}</ul></div>
              </div>
            </div>
          )}
        </section>

        <section className={`report-page ${activeTab === "color" ? "active" : ""}`}>
          <SectionTitle eyebrow="COLOR SYSTEM" title="色彩与风格拆解" description="色值来自画面视觉估计，用于建立调色方向而非精确取样。" />
          <div className="palette-grid">
            {report.visualSignature.palette.map((color) => (
              <article key={color.hex}>
                <span className="color-block" style={{ backgroundColor: color.hex }} />
                <div><strong>{color.name}</strong><code>{color.hex}</code><p>{color.role}</p></div>
              </article>
            ))}
          </div>
          <div className="style-grid">
            <article><span>TONALITY</span><h3>影调结构</h3><p>{report.visualSignature.tone}</p></article>
            <article><span>MOOD</span><h3>情绪表达</h3><p>{report.visualSignature.mood}</p></article>
            <article><span>REFERENCE</span><h3>风格坐标</h3><p>{report.visualSignature.styleReferences.join("、")}</p></article>
          </div>
        </section>

        <section className={`report-page ${activeTab === "post" ? "active" : ""}`}>
          <SectionTitle eyebrow="POST PRODUCTION" title="后期参数表" description="先在 RAW 阶段完成全局定调，再用 Photoshop 处理局部。" />
          <div className="preset-export">
            <div>
              <span className="export-icon"><Download size={20} /></span>
              <div><strong>生成通用调色预设</strong><p>同一份 XMP 可导入像素蛋糕桌面版、Adobe Camera Raw 和 Lightroom。</p></div>
            </div>
            <button type="button" className="button primary" onClick={() => {
              const count = downloadXmp(report);
              setExportMessage(`已写入 ${count} 个可识别参数`);
              window.setTimeout(() => setExportMessage(""), 4000);
            }}><Download size={17} />下载 XMP</button>
            <small>{exportMessage || "像素蛋糕：预设面板 + → 从本地导入；Camera Raw：预设 → 导入配置文件和预设。"}</small>
          </div>
          <div className="post-section">
            <div className="post-title"><span>01</span><div><h3>像素蛋糕</h3><p>滑杆名称可能因版本不同略有差异，请按模块和目的对应。</p></div></div>
            <ParameterTable rows={report.post.pixelCake} />
          </div>
          <div className="post-section">
            <div className="post-title"><span>02</span><div><h3>Camera Raw / Lightroom</h3><p>建议值以常用 Adobe 参数范围表达。</p></div></div>
            <ParameterTable rows={report.post.cameraRaw} />
          </div>
          <div className="post-section">
            <div className="post-title"><span>03</span><div><h3>Photoshop 精修</h3><p>仅保留需要图层、蒙版或局部控制的步骤。</p></div></div>
            <div className="ps-steps">
              {report.post.photoshop.map((item) => (
                <article key={item.step}><span>{item.step}</span><div><strong>{item.action}</strong><code>{item.settings}</code><p>{item.purpose}</p></div></article>
              ))}
            </div>
          </div>
        </section>

        <section className={`report-page ${activeTab === "ai" ? "active" : ""}`}>
          <SectionTitle
            eyebrow="AI IMAGE WORKFLOW"
            title={aiAdvice.mode === "style_transfer" ? "把参考风格应用到用户成片" : "生成同摄影风格的新照片"}
            description="提示词已从画面分析自动生成，可以先修改内容与约束，再调用图像模型。"
          />

          <div className="ai-strategy">
            <span><WandSparkles size={22} /></span>
            <div><strong>生成策略</strong><p>{aiAdvice.strategy}</p></div>
          </div>

          <div className="ai-plan">
            {aiAdvice.retouchPlan.map((item, index) => (
              <article key={`${item.target}-${index}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{item.target}</strong><p>{item.instruction}</p></div>
                <small className={`strength s-${item.strength}`}>{item.strength}</small>
              </article>
            ))}
          </div>

          <div className="ai-workbench">
            <div className="prompt-editor">
              <div className="workbench-heading">
                <div><span>PROMPT</span><h3>可编辑生图提示词</h3></div>
                <button type="button" className="icon-text-button" onClick={() => void copyPrompt()} title="复制完整提示词">
                  <Copy size={15} />{copyMessage || "复制"}
                </button>
              </div>
              <textarea value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} maxLength={12000} spellCheck={false} />
              <div className="prompt-count"><span>建议保留“必须保持”和“硬性约束”两段</span><b>{aiPrompt.length.toLocaleString("zh-CN")} / 12,000</b></div>

              <div className="constraint-grid">
                <div><strong>必须保持</strong><ul>{aiAdvice.preserve.map((item) => <li key={item}>{item}</li>)}</ul></div>
                <div><strong>硬性约束</strong><ul>{aiAdvice.constraints.map((item) => <li key={item}>{item}</li>)}</ul></div>
              </div>
            </div>

            <div className="generation-panel">
              <div className="workbench-heading"><div><span>OUTPUT</span><h3>生成设置与结果</h3></div></div>

              <fieldset className="generation-control">
                <legend>画幅</legend>
                <div className="option-segmented">
                  <button type="button" className={imageSize === "1024x1536" ? "active" : ""} onClick={() => setImageSize("1024x1536")}><RectangleVertical size={16} />竖幅</button>
                  <button type="button" className={imageSize === "1536x1024" ? "active" : ""} onClick={() => setImageSize("1536x1024")}><RectangleHorizontal size={16} />横幅</button>
                  <button type="button" className={imageSize === "1024x1024" ? "active" : ""} onClick={() => setImageSize("1024x1024")}><Square size={16} />方形</button>
                </div>
              </fieldset>

              <fieldset className="generation-control">
                <legend>质量</legend>
                <div className="option-segmented quality-options">
                  {(["low", "medium", "high"] as ImageQuality[]).map((quality) => (
                    <button type="button" key={quality} className={imageQuality === quality ? "active" : ""} onClick={() => setImageQuality(quality)}>
                      {quality === "low" ? "快速" : quality === "medium" ? "标准" : "精细"}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className={`generated-preview ${generatedImage ? "has-image" : ""}`}>
                {generatedImage ? (
                  <img src={generatedImage.imageDataUrl} alt="AI 生成的同风格照片" />
                ) : generating ? (
                  <div className="generation-wait">
                    <LoaderCircle className="spin" size={30} />
                    <strong>{generationMessage}</strong>
                    <span>已等待 {Math.floor(generationElapsed / 60_000).toString().padStart(2, "0")}:{Math.floor((generationElapsed % 60_000) / 1000).toString().padStart(2, "0")}</span>
                    <i className="indeterminate"><b /></i>
                    <button type="button" onClick={() => generationController.current?.abort()}>取消生成</button>
                  </div>
                ) : (
                  <div className="generation-empty"><Image size={29} /><strong>生成结果会显示在这里</strong><span>{imageSize} · {imageQuality === "low" ? "快速" : imageQuality === "medium" ? "标准" : "精细"}</span></div>
                )}
              </div>

              {generationError && <div className="generation-error"><AlertTriangle size={16} />{generationError}</div>}
              {response.demo && <p className="generation-note">演示报告没有原始照片。完成一次真实照片分析后即可直接生成。</p>}
              {!response.demo && !reference && <p className="generation-note">历史记录缺少原始参考图，无法发起生成。</p>}

              <div className="generation-actions">
                {generatedImage && (
                  <a className="button ghost" href={generatedImage.imageDataUrl} download={`同风格照片-${response.requestId.slice(0, 8)}.jpg`}><Download size={17} />下载照片</a>
                )}
                <button type="button" className="button primary" onClick={() => void generateImage()} disabled={generating || response.demo || !reference || aiPrompt.trim().length < 40}>
                  {generating ? <LoaderCircle className="spin" size={18} /> : generatedImage ? <RefreshCw size={17} /> : <WandSparkles size={18} />}
                  {generating ? "生成中" : generatedImage ? "重新生成" : aiAdvice.mode === "style_transfer" ? "应用参考风格" : "生成同风格照片"}
                </button>
              </div>
              {generatedImage && <small className="generated-meta">{generatedImage.model} · {generatedImage.size} · {generatedImage.quality}</small>}
            </div>
          </div>
        </section>

        {report.comparison.enabled && (
          <section className={`report-page ${activeTab === "compare" ? "active" : ""}`}>
            <SectionTitle eyebrow="GAP ANALYSIS" title="参考图与成片差异" description={report.comparison.summary} />
            <div className="difference-list">
              {report.comparison.differences.map((item, index) => (
                <article key={`${item.dimension}-${index}`}>
                  <div className="difference-head"><span>{String(index + 1).padStart(2, "0")}</span><h3>{item.dimension}</h3><Priority value={item.priority} /></div>
                  <div className="difference-grid">
                    <div><small>参考图</small><p>{item.reference}</p></div>
                    <div><small>用户成片</small><p>{item.current}</p></div>
                    <div className="fix"><small>修正动作</small><p>{item.fix}</p></div>
                  </div>
                </article>
              ))}
            </div>
            <div className="sequence-section">
              <h3>建议修正顺序</h3>
              <ol>{report.comparison.sequence.map((item) => <li key={item}><CheckCircle2 size={18} />{item}</li>)}</ol>
            </div>
          </section>
        )}
      </div>

      <footer className="report-footer">
        <span>请求 {response.requestId.slice(0, 8)}</span>
        <span>{response.model}</span>
        {response.demo && response.model !== "演示数据" && <span>演示数据</span>}
      </footer>
    </main>
  );
}
