# 仿拍工作台（Photo Replica Studio）

面向摄影内容创作者的照片拆解与仿拍辅助工具。上传一张参考照片，或同时上传参考图与自己的成片，即可获得结构化的拍摄方案、后期参数、差异分析和 AI 同风格生成提示词。

## 功能

- 识别人像、风光、街拍、建筑、静物等场景类型
- 分析构图、机位、焦段、曝光、光位、光质、色彩、服饰、妆发和姿态
- 针对风光照片补充天气、季节、时间窗口、滤镜、景深与现场清单
- 对比参考图和用户成片，按优先级输出差异与修正顺序
- 生成像素蛋糕、Camera Raw / Lightroom 的具体参数表
- 输出 Photoshop 局部精修步骤
- 生成可导入像素蛋糕、Camera Raw 和 Lightroom 的通用 XMP 预设
- 自动生成 AI 修图动作、保持项、硬性约束和可编辑生图提示词
- 使用参考图生成原创同风格照片，或把参考风格迁移到用户成片
- 流式显示分析进度、真实等待时间和活动记录，支持取消与超时保护
- 使用 IndexedDB 在本机保存、恢复和删除分析历史
- 无账号即可使用，支持演示报告、响应式布局和打印

## 技术栈

- React 19、TypeScript、Vite
- Express、Multer
- OpenAI Node SDK（兼容 OpenAI API 的服务）
- IndexedDB 本地历史记录
- 原生 XMP 预设生成

## 工作流程

```text
上传照片
  -> 服务端内存处理
  -> 视觉模型输出严格 JSON 报告
  -> 拍摄建议 / 参数表 / AI 提示词
  -> 本地历史记录 / XMP 下载 / AI 图像生成
```

照片不会由项目服务端写入磁盘。分析历史保存在当前浏览器的 IndexedDB 中；AI 生成结果仅返回浏览器预览，需要长期保留时请下载。

## 本地运行

要求 Node.js 20 或更高版本。

```powershell
git clone <repository-url>
cd photo-replica-studio
npm install
Copy-Item .env.example .env
```

编辑 `.env`，填入自己的 API 地址、密钥和可用模型：

```dotenv
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5.6-terra
OPENAI_API_MODE=responses
OPENAI_IMAGE_DETAIL=high
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_QUALITY=medium
OPENAI_REASONING_EFFORT=medium
ANALYSIS_TIMEOUT_MS=240000
IMAGE_GENERATION_TIMEOUT_MS=300000
OPENAI_USER_AGENT=node
PORT=8787
```

启动开发服务：

```powershell
npm run dev
```

- 前端开发地址：`http://localhost:5173`
- API 地址：`http://localhost:8787`

## API 兼容性

默认使用 Responses API 和 JSON Schema 结构化输出。所选分析模型需要支持图像输入、流式响应和结构化输出；图像模型需要支持 Images Edit API 及参考图输入。

如果服务只兼容 Chat Completions，可修改：

```dotenv
OPENAI_API_MODE=chat
```

不同 API 服务开放的模型和图像生成能力可能不同，请通过 `OPENAI_MODEL` 与 `OPENAI_IMAGE_MODEL` 分别配置。图像生成出现长时间等待时，可先将 `OPENAI_IMAGE_QUALITY` 改为 `low`，或切换为服务实际支持的图像模型。

## XMP 预设

在报告的“后期参数”页点击“下载 XMP”。

- 像素蛋糕桌面版：预设面板右上角 `+` -> “导入预设” -> “从本地导入”
- Camera Raw：预设面板 -> “导入配置文件和预设”

XMP 只写入报告中能够明确转换为 Adobe 参数的项目。人像磨皮、塑形以及依赖蒙版的 Photoshop 操作仍以步骤清单呈现。

## 常用命令

```powershell
npm run dev        # 同时启动前端和 API
npm run typecheck  # TypeScript 检查
npm run build      # 生产构建
npm start          # 启动生产服务（http://localhost:8787）
```

## 安全与隐私

- `.env`、本地输出、依赖目录和构建产物均被 Git 忽略
- API Key 只由 Node 服务读取，不会发送到浏览器
- OpenAI 分析请求显式设置 `store: false`
- 上传文件保存在服务端内存中，单张上限 20 MB
- 浏览器历史中的照片会压缩至最长边 1600px，并仅保存在本机
- 请勿把真实密钥写入 `.env.example`、源码、Issue、日志或截图

## 已知限制

- 焦段、机型、灯光功率和原始调色参数无法仅凭导出图片精确还原，报告中的数值是复现建议和视觉估计区间
- 不同版本的像素蛋糕可能使用不同的参数名称，需要按模块和调整目的对应
- AI 图像生成速度和可用参数取决于所连接的 API 服务
