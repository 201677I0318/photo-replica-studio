import OpenAI, { toFile } from "openai";
import type { Express } from "express";
import type { AnalysisMode } from "../shared/report.js";

const apiKey = process.env.OPENAI_API_KEY;
const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const imageModel = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const defaultQuality = parseQuality(process.env.OPENAI_IMAGE_QUALITY);
const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export const imageGenerationConfig = {
  configured: Boolean(apiKey),
  model: imageModel,
  defaultQuality,
};

export type ImageSize = "1024x1536" | "1536x1024" | "1024x1024";
export type ImageQuality = "low" | "medium" | "high";

interface GenerateImageArgs {
  mode: AnalysisMode;
  reference: Express.Multer.File;
  current?: Express.Multer.File;
  prompt: string;
  size: ImageSize;
  quality: ImageQuality;
  signal?: AbortSignal;
}

function parseQuality(value: string | undefined): ImageQuality {
  return value === "low" || value === "high" ? value : "medium";
}

export function normalizeImageSize(value: unknown): ImageSize {
  return value === "1536x1024" || value === "1024x1024" ? value : "1024x1536";
}

export function normalizeImageQuality(value: unknown): ImageQuality {
  return parseQuality(typeof value === "string" ? value : undefined);
}

function createClient() {
  if (!apiKey) throw new Error("尚未配置 OPENAI_API_KEY，无法生成照片。");
  return new OpenAI({
    apiKey,
    baseURL,
    defaultHeaders: { "User-Agent": process.env.OPENAI_USER_AGENT || "node" },
  });
}

async function uploadable(file: Express.Multer.File) {
  if (!supportedImageTypes.has(file.mimetype)) {
    throw new Error("AI 生图仅支持 JPG、PNG 或 WEBP 图片。");
  }
  return toFile(file.buffer, file.originalname || "photo.jpg", { type: file.mimetype });
}

function operationalPrompt(args: GenerateImageArgs) {
  const roleInstruction = args.mode === "compare"
    ? `图像 1 是唯一的编辑底图（用户成片），图像 2 仅作为摄影风格参考。
必须保留图像 1 中人物的身份、五官、肤色、年龄、体型比例、发型、表情、姿势、手部结构，以及提示词未明确要求修改的构图和背景几何。只迁移图像 2 的光线、色彩、影调、材质和后期语言。`
    : `输入图像只作为摄影风格参考。创作一张新的原创照片，提取其光线、色彩、影调、材质、构图逻辑和镜头观感，但不要复刻参考人物身份、精确姿势、精确构图或独有场景细节。`;

  return `执行模式：真实摄影图像编辑与生成。
图像角色：${roleInstruction}

分析生成的创作提示词：
${args.prompt.trim()}

最终检查：画面必须保持摄影真实感和自然人体结构；不得生成文字、标志、水印、多余人物、多余手指或肢体；不要把照片变成插画、3D 渲染或过度磨皮的人造质感。`;
}

async function imageDataUrl(image: { b64_json?: string | null; url?: string | null }) {
  if (image.b64_json) return `data:image/jpeg;base64,${image.b64_json}`;
  if (!image.url) throw new Error("图像模型没有返回可用图片。");

  const response = await fetch(image.url);
  if (!response.ok) throw new Error("图像已生成，但下载生成结果失败。");
  const type = response.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${type};base64,${buffer.toString("base64")}`;
}

export async function generateStyledImage(args: GenerateImageArgs) {
  const client = createClient();
  const sourceFiles = args.mode === "compare"
    ? [args.current, args.reference].filter(Boolean) as Express.Multer.File[]
    : [args.reference];
  const images = await Promise.all(sourceFiles.map(uploadable));

  const response = await client.images.edit({
    model: imageModel,
    image: images,
    prompt: operationalPrompt(args),
    n: 1,
    size: args.size,
    quality: args.quality,
    output_format: "jpeg",
    output_compression: 92,
    ...(imageModel.startsWith("gpt-image-2")
      ? {}
      : { input_fidelity: args.mode === "compare" ? "high" as const : "low" as const }),
  }, { signal: args.signal });

  const image = response.data?.[0];
  if (!image) throw new Error("图像模型没有返回可用图片。");

  return {
    imageDataUrl: await imageDataUrl(image),
    model: imageModel,
    size: args.size,
    quality: args.quality,
  };
}
