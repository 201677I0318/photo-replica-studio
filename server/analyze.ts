import OpenAI from "openai";
import type { Express } from "express";
import type { AnalysisMode, PhotoReport } from "../shared/report.js";
import { buildPrompt } from "./prompt.js";
import { photoReportSchema } from "./report-schema.js";

const apiKey = process.env.OPENAI_API_KEY;
const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const model = process.env.OPENAI_MODEL || "gpt-5.6-terra";
const apiMode = process.env.OPENAI_API_MODE === "chat" ? "chat" : "responses";
const imageDetail: "original" | "high" = process.env.OPENAI_IMAGE_DETAIL === "original" ? "original" : "high";
const supportedEfforts = ["none", "low", "medium", "high", "xhigh", "max"] as const;
type ReasoningEffort = (typeof supportedEfforts)[number];
const configuredEffort = process.env.OPENAI_REASONING_EFFORT as ReasoningEffort | undefined;
const reasoningEffort: ReasoningEffort = configuredEffort && supportedEfforts.includes(configuredEffort)
  ? configuredEffort
  : "medium";

interface AnalyzeArgs {
  mode: AnalysisMode;
  reference: Express.Multer.File;
  current?: Express.Multer.File;
  note: string;
}

export interface AnalysisProgressEvent {
  progress: number;
  message: string;
  detail: string;
}

export const openAIConfig = {
  configured: Boolean(apiKey),
  model,
  apiMode,
  reasoningEffort,
};

function dataUrl(file: Express.Multer.File) {
  return `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
}

function parseReport(raw: string): PhotoReport {
  try {
    return JSON.parse(raw) as PhotoReport;
  } catch {
    throw new Error("模型返回的报告不是有效 JSON，请重试或更换支持结构化输出的模型。", { cause: raw.slice(0, 400) });
  }
}

function createClient() {
  if (!apiKey) {
    throw new Error("尚未配置 OPENAI_API_KEY。请先创建 .env，或使用演示报告预览完整流程。");
  }

  return new OpenAI({
    apiKey,
    baseURL,
    // Some OpenAI-compatible relays block the SDK's default user agent at the CDN layer.
    defaultHeaders: { "User-Agent": process.env.OPENAI_USER_AGENT || "node" },
  });
}

function responseInput(args: AnalyzeArgs) {
  const prompt = buildPrompt(args.mode, args.note);
  const images = [args.reference, args.current].filter(Boolean) as Express.Multer.File[];
  const content: OpenAI.Responses.ResponseInputContent[] = [
    { type: "input_text", text: prompt },
    ...images.map((file) => ({
      type: "input_image" as const,
      image_url: dataUrl(file),
      detail: imageDetail,
    })),
  ];
  return [{ role: "user" as const, content }];
}

function streamedProgress(output: string, mode: AnalysisMode): AnalysisProgressEvent {
  let phaseFloor = 34;
  let message = "正在建立报告结构";
  if (output.includes('"visualSignature"')) {
    phaseFloor = 40;
    message = "正在提取色彩与风格";
  }
  if (output.includes('"capture"')) {
    phaseFloor = 50;
    message = "正在生成现场拍摄方案";
  }
  if (output.includes('"comparison"')) {
    phaseFloor = 62;
    message = mode === "compare" ? "正在整理差异与修正顺序" : "正在整理拍摄建议";
  }
  if (output.includes('"post"')) {
    phaseFloor = 70;
    message = "正在生成后期参数表";
  }
  if (output.includes('"aiImage"')) {
    phaseFloor = 82;
    message = "正在编写 AI 修图方案与提示词";
  }
  if (output.includes('"risks"')) {
    phaseFloor = 90;
    message = "正在校验完整报告";
  }
  const lengthEstimate = 34 + Math.round(58 * (1 - Math.exp(-output.length / 3600)));
  const progress = Math.min(92, Math.max(phaseFloor, lengthEstimate));
  return {
    progress,
    message,
    detail: `已生成 ${output.length.toLocaleString("zh-CN")} 个报告字符`,
  };
}

export async function analyzePhotos(args: AnalyzeArgs) {
  const client = createClient();
  const prompt = buildPrompt(args.mode, args.note);
  const images = [args.reference, args.current].filter(Boolean) as Express.Multer.File[];

  if (apiMode === "chat") {
    const content = [
      { type: "text" as const, text: prompt },
      ...images.map((file) => ({
        type: "image_url" as const,
        image_url: { url: dataUrl(file), detail: "high" as const },
      })),
    ];

    const response = await client.chat.completions.create({
      model,
      store: false,
      messages: [{ role: "user", content }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "photo_replica_report",
          strict: true,
          schema: photoReportSchema,
        },
      },
    });

    const output = response.choices[0]?.message.content;
    if (!output) throw new Error("模型没有返回可用的分析内容。");
    return parseReport(output);
  }

  const response = await client.responses.create({
    model,
    store: false,
    input: responseInput(args),
    reasoning: { effort: reasoningEffort },
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "photo_replica_report",
        strict: true,
        schema: photoReportSchema,
      },
    },
  });

  if (!response.output_text) throw new Error("模型没有返回可用的分析内容。");
  return parseReport(response.output_text);
}

export async function analyzePhotosStream(
  args: AnalyzeArgs,
  options: {
    signal: AbortSignal;
    onProgress: (event: AnalysisProgressEvent) => void;
  },
) {
  const client = createClient();
  let output = "";
  let lastUpdate = 0;
  let lastMessage = "";

  const emitOutputProgress = () => {
    const update = streamedProgress(output, args.mode);
    const now = Date.now();
    if (update.message !== lastMessage || now - lastUpdate >= 700) {
      lastMessage = update.message;
      lastUpdate = now;
      options.onProgress(update);
    }
  };

  if (apiMode === "chat") {
    const prompt = buildPrompt(args.mode, args.note);
    const images = [args.reference, args.current].filter(Boolean) as Express.Multer.File[];
    const content = [
      { type: "text" as const, text: prompt },
      ...images.map((file) => ({
        type: "image_url" as const,
        image_url: { url: dataUrl(file), detail: "high" as const },
      })),
    ];
    const stream = await client.chat.completions.create({
      model,
      store: false,
      stream: true,
      messages: [{ role: "user", content }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "photo_replica_report", strict: true, schema: photoReportSchema },
      },
    }, { signal: options.signal });

    options.onProgress({ progress: 28, message: "模型已开始分析", detail: "正在读取画面内容" });
    for await (const chunk of stream) {
      output += chunk.choices[0]?.delta.content || "";
      emitOutputProgress();
    }
  } else {
    const stream = await client.responses.create({
      model,
      store: false,
      stream: true,
      input: responseInput(args),
      reasoning: { effort: reasoningEffort },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "photo_replica_report",
          strict: true,
          schema: photoReportSchema,
        },
      },
    }, { signal: options.signal });

    for await (const event of stream) {
      if (event.type === "response.created") {
        options.onProgress({ progress: 24, message: "模型已接收照片", detail: "开始识别主体与画面类型" });
      } else if (event.type === "response.in_progress") {
        options.onProgress({ progress: 30, message: "模型正在分析画面", detail: "构图、光线与色彩正在处理中" });
      } else if (event.type === "response.output_text.delta") {
        output += event.delta;
        emitOutputProgress();
      } else if (event.type === "response.failed") {
        throw new Error(event.response.error?.message || "模型分析失败，请重试。");
      } else if (event.type === "error") {
        throw new Error(event.message || "模型流式响应发生错误。");
      }
    }
  }

  if (!output) throw new Error("模型没有返回可用的分析内容。");
  options.onProgress({ progress: 96, message: "正在校验报告", detail: "检查参数与报告结构" });
  return parseReport(output);
}
