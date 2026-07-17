import type { ParameterRow, PhotoReport } from "../shared/report";

const basicKeys: Record<string, string> = {
  "曝光": "Exposure2012",
  "对比度": "Contrast2012",
  "高光": "Highlights2012",
  "阴影": "Shadows2012",
  "白色": "Whites2012",
  "黑色": "Blacks2012",
  "纹理": "Texture",
  "清晰度": "Clarity2012",
  "去朦胧": "Dehaze",
  "自然饱和度": "Vibrance",
  "饱和度": "Saturation",
  "色调": "Tint",
  "锐化": "Sharpness",
  "明亮度降噪": "LuminanceSmoothing",
  "颜色降噪": "ColorNoiseReduction",
  "颗粒": "GrainAmount",
  "晕影": "PostCropVignetteAmount",
};

const colorKeys: Record<string, string> = {
  "红色": "Red",
  "橙色": "Orange",
  "黄色": "Yellow",
  "绿色": "Green",
  "浅绿色": "Aqua",
  "青色": "Aqua",
  "蓝色": "Blue",
  "紫色": "Purple",
  "洋红": "Magenta",
};

function numericValues(value: string) {
  return [...value.matchAll(/[+-]?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
}

function addSetting(settings: Map<string, string>, key: string, value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return;
  settings.set(key, String(value));
}

function collectSettings(rows: ParameterRow[]) {
  const settings = new Map<string, string>();

  for (const row of rows) {
    const numbers = numericValues(row.value);
    const color = Object.keys(colorKeys).find((name) => row.parameter.includes(name));
    if (color && /H\s*\/\s*S\s*\/\s*L/i.test(row.parameter) && numbers.length >= 3) {
      const suffix = colorKeys[color];
      addSetting(settings, `HueAdjustment${suffix}`, numbers[0]);
      addSetting(settings, `SaturationAdjustment${suffix}`, numbers[1]);
      addSetting(settings, `LuminanceAdjustment${suffix}`, numbers[2]);
      continue;
    }

    if (/蓝原色/.test(row.parameter) && numbers.length >= 2) {
      addSetting(settings, "BluePrimaryHue", numbers[0]);
      addSetting(settings, "BluePrimarySaturation", numbers[1]);
      continue;
    }
    if (/红原色/.test(row.parameter) && numbers.length >= 2) {
      addSetting(settings, "RedPrimaryHue", numbers[0]);
      addSetting(settings, "RedPrimarySaturation", numbers[1]);
      continue;
    }
    if (/绿原色/.test(row.parameter) && numbers.length >= 2) {
      addSetting(settings, "GreenPrimaryHue", numbers[0]);
      addSetting(settings, "GreenPrimarySaturation", numbers[1]);
      continue;
    }

    if (/颜色分级/.test(row.section) || /阴影.*高光/.test(row.parameter)) {
      const shadow = row.value.match(/阴影[^\d]*(\d+)[^\d]+(\d+)/);
      const highlight = row.value.match(/高光[^\d]*(\d+)[^\d]+(\d+)/);
      const balance = row.value.match(/平衡\s*([+-]?\d+)/);
      if (shadow) {
        addSetting(settings, "ColorGradeShadowHue", Number(shadow[1]));
        addSetting(settings, "ColorGradeShadowSat", Number(shadow[2]));
      }
      if (highlight) {
        addSetting(settings, "ColorGradeHighlightHue", Number(highlight[1]));
        addSetting(settings, "ColorGradeHighlightSat", Number(highlight[2]));
      }
      if (balance) addSetting(settings, "ColorGradeBalance", Number(balance[1]));
      continue;
    }

    const labels = row.parameter.split("/").map((label) => label.trim());
    labels.forEach((label, index) => {
      const match = Object.keys(basicKeys).find((name) => label.includes(name));
      if (match) addSetting(settings, basicKeys[match], numbers[index]);
    });

    if (row.parameter.includes("色温")) {
      const temperature = numbers.find((value) => value >= 2000 && value <= 50000);
      addSetting(settings, "Temperature", temperature);
    }
  }

  return settings;
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;",
  })[character] || character);
}

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 70) || "摄影调色方案";
}

export function downloadXmp(report: PhotoReport) {
  const settings = collectSettings(report.post.cameraRaw);
  const name = `${report.meta.title} - 仿拍工作台`;
  const uuid = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  const attributes = [...settings.entries()].map(([key, value]) => `      crs:${key}="${escapeXml(value)}"`).join("\n");
  const notes = report.post.cameraRaw.map((row) => `${row.section}｜${row.parameter}：${row.value}`).join("；");
  const xmp = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="仿拍工作台">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      crs:PresetType="Normal"
      crs:Cluster="仿拍工作台"
      crs:UUID="${uuid}"
      crs:SupportsAmount="True"
      crs:SupportsColor="True"
      crs:SupportsMonochrome="True"
      crs:Version="16.0"
      crs:ProcessVersion="15.4"
${attributes}>
      <crs:Name><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(name)}</rdf:li></rdf:Alt></crs:Name>
      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(notes)}</rdf:li></rdf:Alt></dc:description>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  const url = URL.createObjectURL(new Blob([xmp], { type: "application/rdf+xml" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFilename(report.meta.title)}.xmp`;
  anchor.click();
  URL.revokeObjectURL(url);
  return settings.size;
}
