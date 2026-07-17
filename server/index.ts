import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import type { AnalysisMode } from "../shared/report.js";
import { analyzePhotos, analyzePhotosStream, openAIConfig } from "./analyze.js";
import { createDemoReport } from "./demo-report.js";
import {
  generateStyledImage,
  imageGenerationConfig,
  normalizeImageQuality,
  normalizeImageSize,
} from "./image-generation.js";

const app = express();
const port = Number(process.env.PORT || 8787);
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const uploadFields: multer.Field[] = [
  { name: "reference", maxCount: 1 },
  { name: "current", maxCount: 1 },
];
const analysisTimeoutMs = Math.max(30_000, Number(process.env.ANALYSIS_TIMEOUT_MS || 240_000));
const imageGenerationTimeoutMs = Math.max(60_000, Number(process.env.IMAGE_GENERATION_TIMEOUT_MS || 300_000));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 2 },
  fileFilter: (_request, file, callback) => {
    if (!allowedTypes.has(file.mimetype)) {
      callback(new Error("仅支持 JPG、PNG、WEBP 或非动图 GIF。"));
      return;
    }
    callback(null, true);
  },
});

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

app.get("/api/status", (_request, response) => {
  response.json({
    ...openAIConfig,
    imageConfigured: imageGenerationConfig.configured,
    imageModel: imageGenerationConfig.model,
    imageQuality: imageGenerationConfig.defaultQuality,
  });
});

app.post("/api/demo", (request, response) => {
  const mode: AnalysisMode = request.body?.mode === "compare" ? "compare" : "reference";
  response.json({
    report: createDemoReport(mode),
    requestId: crypto.randomUUID(),
    model: "演示数据",
    demo: true,
  });
});

app.post(
  "/api/generate-image",
  upload.fields(uploadFields),
  async (request, response, next) => {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), imageGenerationTimeoutMs);
    try {
      const files = request.files as Record<string, Express.Multer.File[]> | undefined;
      const reference = files?.reference?.[0];
      const current = files?.current?.[0];
      const mode: AnalysisMode = request.body.mode === "compare" ? "compare" : "reference";
      const prompt = String(request.body.prompt || "").trim().slice(0, 12_000);

      if (!reference) {
        response.status(400).json({ error: "生成照片需要原始参考图。" });
        return;
      }
      if (mode === "compare" && !current) {
        response.status(400).json({ error: "风格迁移需要用户成片作为编辑底图。" });
        return;
      }
      if (prompt.length < 40) {
        response.status(400).json({ error: "提示词过短，请保留必要的场景、光线和约束说明。" });
        return;
      }

      const result = await generateStyledImage({
        mode,
        reference,
        current,
        prompt,
        size: normalizeImageSize(request.body.size),
        quality: normalizeImageQuality(request.body.quality),
        signal: abortController.signal,
      });
      response.json(result);
    } catch (error) {
      if (abortController.signal.aborted) {
        response.status(504).json({ error: "图像生成等待超时，请降低质量后重试。" });
        return;
      }
      next(error);
    } finally {
      clearTimeout(timeout);
    }
  },
);

app.post(
  "/api/analyze",
  upload.fields(uploadFields),
  async (request, response, next) => {
    try {
      const files = request.files as Record<string, Express.Multer.File[]> | undefined;
      const reference = files?.reference?.[0];
      const current = files?.current?.[0];
      const mode: AnalysisMode = request.body.mode === "compare" ? "compare" : "reference";
      const note = String(request.body.note || "").slice(0, 1000);

      if (!reference) {
        response.status(400).json({ error: "请先上传参考照片。" });
        return;
      }
      if (mode === "compare" && !current) {
        response.status(400).json({ error: "对比分析需要同时上传用户成片。" });
        return;
      }

      const report = await analyzePhotos({ mode, reference, current, note });
      response.json({
        report,
        requestId: crypto.randomUUID(),
        model: openAIConfig.model,
        demo: false,
      });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/analyze-stream",
  upload.fields(uploadFields),
  async (request, response) => {
    const files = request.files as Record<string, Express.Multer.File[]> | undefined;
    const reference = files?.reference?.[0];
    const current = files?.current?.[0];
    const mode: AnalysisMode = request.body.mode === "compare" ? "compare" : "reference";
    const note = String(request.body.note || "").slice(0, 1000);

    if (!reference) {
      response.status(400).json({ error: "请先上传参考照片。" });
      return;
    }
    if (mode === "compare" && !current) {
      response.status(400).json({ error: "对比分析需要同时上传用户成片。" });
      return;
    }

    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const abortController = new AbortController();
    let finished = false;
    let timedOut = false;
    let progress = 10;
    let currentMessage = "照片已上传";

    response.status(200);
    response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();

    const send = (payload: Record<string, unknown>) => {
      if (!response.destroyed && !response.writableEnded) {
        response.write(`${JSON.stringify(payload)}\n`);
      }
    };
    const sendProgress = (next: { progress: number; message: string; detail: string }) => {
      progress = Math.max(progress, next.progress);
      currentMessage = next.message;
      send({
        type: "progress",
        progress,
        message: next.message,
        detail: next.detail,
        elapsedMs: Date.now() - startedAt,
      });
    };

    sendProgress({ progress: 10, message: "照片已上传", detail: "正在准备视觉分析请求" });

    const heartbeat = setInterval(() => {
      send({
        type: "heartbeat",
        progress,
        message: currentMessage,
        detail: "连接正常，模型仍在生成完整报告",
        elapsedMs: Date.now() - startedAt,
      });
    }, 10_000);
    const timeout = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, analysisTimeoutMs);

    response.on("close", () => {
      if (!finished) abortController.abort();
    });

    try {
      const report = await analyzePhotosStream(
        { mode, reference, current, note },
        { signal: abortController.signal, onProgress: sendProgress },
      );
      sendProgress({ progress: 100, message: "分析完成", detail: "报告已生成" });
      send({
        type: "result",
        data: { report, requestId, model: openAIConfig.model, demo: false },
        elapsedMs: Date.now() - startedAt,
      });
      finished = true;
      response.end();
    } catch (error) {
      if (!response.destroyed) {
        const message = timedOut
          ? `分析超过 ${Math.round(analysisTimeoutMs / 60_000)} 分钟，已停止本次请求。请重试或降低图片精度。`
          : error instanceof Error && error.name === "AbortError"
            ? "分析已取消。"
            : error instanceof Error
              ? error.message
              : "分析失败，请稍后重试。";
        send({ type: "error", error: message, elapsedMs: Date.now() - startedAt });
        finished = true;
        response.end();
      }
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timeout);
    }
  },
);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "分析失败，请稍后重试。";
  const status = error instanceof multer.MulterError || message.includes("仅支持") ? 400 : 500;
  console.error("[api]", error);
  response.status(status).json({ error: message });
});

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(currentDir, "../dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((request, response, next) => {
    if (request.method === "GET" && request.accepts("html")) {
      response.sendFile(path.join(distDir, "index.html"));
      return;
    }
    next();
  });
}

app.listen(port, () => {
  console.log(`Photo Replica Studio API listening on http://localhost:${port}`);
  console.log(`OpenAI: ${openAIConfig.configured ? "configured" : "not configured"} · ${openAIConfig.apiMode} · ${openAIConfig.model}`);
});
