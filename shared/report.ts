export type AnalysisMode = "reference" | "compare";

export type Confidence = "高" | "中" | "低";

export interface ParameterRow {
  section: string;
  parameter: string;
  value: string;
  rationale: string;
}

export interface AiImageAdvice {
  mode: "style_variation" | "style_transfer";
  strategy: string;
  retouchPlan: Array<{
    target: string;
    instruction: string;
    strength: "轻微" | "中等" | "明显";
  }>;
  prompt: string;
  preserve: string[];
  constraints: string[];
}

export interface PhotoReport {
  meta: {
    title: string;
    sceneType: "portrait" | "landscape" | "mixed" | "street" | "architecture" | "still_life" | "other";
    sceneTypeLabel: string;
    summary: string;
    confidence: Confidence;
    caveat: string;
  };
  visualSignature: {
    keywords: string[];
    palette: Array<{ name: string; hex: string; role: string }>;
    tone: string;
    mood: string;
    styleReferences: string[];
  };
  capture: {
    composition: Array<{ label: string; observation: string; action: string }>;
    camera: {
      device: string;
      focalLength: string;
      aperture: string;
      shutter: string;
      iso: string;
      whiteBalance: string;
      focus: string;
      aspectRatio: string;
    };
    lighting: {
      summary: string;
      direction: string;
      quality: string;
      contrastRatio: string;
      timeWindow: string;
      setupSteps: string[];
    };
    portrait: {
      applicable: boolean;
      wardrobe: string[];
      makeupHair: string[];
      pose: string[];
      skinTreatment: string[];
    };
    landscape: {
      applicable: boolean;
      weather: string;
      season: string;
      location: string;
      timing: string;
      filters: string[];
      depthPlan: string[];
      fieldChecklist: string[];
    };
    checklist: Array<{ phase: string; item: string; priority: "高" | "中" | "低" }>;
  };
  comparison: {
    enabled: boolean;
    summary: string;
    differences: Array<{
      dimension: string;
      reference: string;
      current: string;
      fix: string;
      priority: "高" | "中" | "低";
    }>;
    sequence: string[];
  };
  post: {
    pixelCake: ParameterRow[];
    cameraRaw: ParameterRow[];
    photoshop: Array<{ step: string; action: string; settings: string; purpose: string }>;
    aiImage: AiImageAdvice;
  };
  risks: Array<{ title: string; detail: string }>;
}

export interface AnalysisResponse {
  report: PhotoReport;
  requestId: string;
  model: string;
  demo: boolean;
}
