type JsonSchema = Record<string, unknown>;

const string = (extra: JsonSchema = {}): JsonSchema => ({ type: "string", ...extra });
const boolean = (): JsonSchema => ({ type: "boolean" });
const array = (items: JsonSchema, maxItems?: number): JsonSchema => ({
  type: "array",
  items,
  ...(maxItems ? { maxItems } : {}),
});
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});

const priority = string({ enum: ["高", "中", "低"] });
const parameterRow = object({
  section: string(),
  parameter: string(),
  value: string(),
  rationale: string(),
});

export const photoReportSchema = object({
  meta: object({
    title: string(),
    sceneType: string({
      enum: ["portrait", "landscape", "mixed", "street", "architecture", "still_life", "other"],
    }),
    sceneTypeLabel: string(),
    summary: string(),
    confidence: string({ enum: ["高", "中", "低"] }),
    caveat: string(),
  }),
  visualSignature: object({
    keywords: array(string(), 6),
    palette: array(object({ name: string(), hex: string(), role: string() }), 6),
    tone: string(),
    mood: string(),
    styleReferences: array(string(), 4),
  }),
  capture: object({
    composition: array(object({ label: string(), observation: string(), action: string() }), 5),
    camera: object({
      device: string(),
      focalLength: string(),
      aperture: string(),
      shutter: string(),
      iso: string(),
      whiteBalance: string(),
      focus: string(),
      aspectRatio: string(),
    }),
    lighting: object({
      summary: string(),
      direction: string(),
      quality: string(),
      contrastRatio: string(),
      timeWindow: string(),
      setupSteps: array(string(), 6),
    }),
    portrait: object({
      applicable: boolean(),
      wardrobe: array(string(), 5),
      makeupHair: array(string(), 5),
      pose: array(string(), 5),
      skinTreatment: array(string(), 4),
    }),
    landscape: object({
      applicable: boolean(),
      weather: string(),
      season: string(),
      location: string(),
      timing: string(),
      filters: array(string(), 5),
      depthPlan: array(string(), 5),
      fieldChecklist: array(string(), 8),
    }),
    checklist: array(object({ phase: string(), item: string(), priority }), 8),
  }),
  comparison: object({
    enabled: boolean(),
    summary: string(),
    differences: array(
      object({ dimension: string(), reference: string(), current: string(), fix: string(), priority }),
      8,
    ),
    sequence: array(string(), 6),
  }),
  post: object({
    pixelCake: array(parameterRow, 10),
    cameraRaw: array(parameterRow, 12),
    photoshop: array(object({ step: string(), action: string(), settings: string(), purpose: string() }), 6),
    aiImage: object({
      mode: string({ enum: ["style_variation", "style_transfer"] }),
      strategy: string(),
      retouchPlan: array(object({
        target: string(),
        instruction: string(),
        strength: string({ enum: ["轻微", "中等", "明显"] }),
      }), 8),
      prompt: string(),
      preserve: array(string(), 8),
      constraints: array(string(), 8),
    }),
  }),
  risks: array(object({ title: string(), detail: string() }), 4),
});
