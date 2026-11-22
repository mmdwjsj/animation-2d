# animation-video 技术架构文档

-   项目：`animation-video`
-   版本：V1.0
-   架构风格：模块化单体
-   核心原则：数据驱动、确定性动画、预览与导出共用运行时

## 1. 架构目标

建立可逐步扩展的 Web 端 2D 动画生产系统。

第一版不包含 LLM 或 AI
剧本分析。系统以固定语法解析器、动画草稿、用户编辑器和确定性动画运行时为核心。

## 2. 技术选型

### 2.1 前端

  层           技术              职责
  ------------ ----------------- ----------------------
  UI           React             页面、面板和交互
  语言         TypeScript        类型系统
  构建         Vite              开发和打包
  样式         Tailwind CSS      布局和样式
  UI 组件      shadcn/ui         基础控件
  状态         Zustand           编辑器状态
  Schema       Zod               运行时数据校验
  画布         PixiJS 8          2D 场景和人物显示
  剧本编辑器   Monaco Editor     文本编辑、行号、定位
  时间轴       自研 React 组件   轨道、事件块和播放头

### 2.2 后端

  层        技术           职责
  --------- -------------- -----------------------------
  Runtime   Node.js        服务运行环境
  语言      TypeScript     后端逻辑
  HTTP      Fastify        API
  数据库    SQLite         项目元数据、配置
  文件      本地文件系统   项目 JSON、图片、音频、视频
  校验      Zod            API 输入输出校验

### 2.3 渲染和音视频

-   PixiJS：网页实时预览。
-   Remotion：最终视频逐帧渲染。
-   FFmpeg：音视频合成、编码和格式处理。
-   TTS Provider：本地 TTS 或外部服务的统一适配层。

不要在第一版同时引入多个相互重叠的动画框架。若 Remotion 的渲染实现需要
React 场景组件，必须复用共享动画计算模块。

## 3. 总体架构

``` text
┌──────────────────────────────────────────────┐
│                 React Web UI                 │
│ 项目首页 / 剧本编辑 / 动画工作台 / 素材管理  │
└──────────────────────┬───────────────────────┘
                       │
             ┌─────────▼─────────┐
             │   Application     │
             │ 项目服务 / 编辑器状态 / 命令 │
             └──────┬────────┬───┘
                    │        │
           ┌────────▼──┐  ┌──▼────────────┐
           │ Script    │  │ Animation     │
           │ Parser    │  │ Editor/Runtime│
           └───────────┘  └──────┬────────┘
                                 │
                       ┌─────────▼─────────┐
                       │ Shared Animation  │
                       │ Data & Evaluation │
                       └──────┬────────┬───┘
                              │        │
                       ┌──────▼───┐ ┌──▼────────┐
                       │ PixiJS   │ │ Remotion  │
                       │ Preview  │ │ Renderer  │
                       └──────────┘ └────┬─────┘
                                         │
                                    ┌────▼─────┐
                                    │ FFmpeg   │
                                    └──────────┘

┌──────────────────────────────────────────────┐
│ Node.js / Fastify Backend                    │
│ Project API / Asset API / TTS API / Render API│
│ SQLite + Local File Storage                  │
└──────────────────────────────────────────────┘
```

第一版采用模块化单体，不拆微服务。前后端可以独立目录，但共享类型和
Schema 应集中管理。

## 4. 推荐目录结构

``` text
animation-video/
├── AGENTS.md
├── README.md
├── package.json
├── docs/
│   ├── PRD.md
│   └── ARCHITECTURE.md
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── pages/
│   │   │   ├── components/
│   │   │   ├── features/
│   │   │   │   ├── projects/
│   │   │   │   ├── script-editor/
│   │   │   │   ├── stage-editor/
│   │   │   │   ├── timeline/
│   │   │   │   ├── characters/
│   │   │   │   └── assets/
│   │   │   └── stores/
│   │   └── package.json
│   └── server/
│       ├── src/
│       │   ├── api/
│       │   ├── services/
│       │   ├── repositories/
│       │   ├── tts/
│       │   └── render/
│       └── package.json
├── packages/
│   ├── shared/
│   │   ├── src/
│   │   │   ├── schemas/
│   │   │   ├── types/
│   │   │   └── constants/
│   ├── script-parser/
│   │   ├── src/
│   │   └── tests/
│   └── animation-core/
│       ├── src/
│       │   ├── evaluator/
│       │   ├── runtime/
│       │   ├── timeline/
│       │   └── geometry/
│       └── tests/
├── assets/
│   ├── characters/
│   ├── scenes/
│   └── props/
└── data/
    ├── projects/
    └── database/
```

如果当前仓库已经有目录结构，先检查并适配，不要为了完全匹配示例而无必要地重构现有代码。

## 5. 模块职责

### 5.1 Project Module

负责： - 创建、打开、保存、删除项目。 - 项目配置和元数据。 -
项目目录初始化。 - 自动保存和版本信息。

不负责： - 剧本解析。 - 动画状态计算。 - 视频编码。

### 5.2 Asset Module

负责： - 人物素材索引。 - 场景素材索引。 - 道具素材索引。 - 素材预览。 -
素材缺失检测。 - 素材引用关系。

素材库与项目实例分离。项目通过稳定的 asset ID
引用素材，不应复制一份难以维护的全局素材定义。

### 5.3 Script Parser Module

输入原始剧本文本，输出 `ScriptDraft`。

职责： - 按行扫描。 - 识别场景声明。 - 识别角色声明。 - 识别对白。 -
识别姿态。 - 处理姿态继承。 - 校验角色和语法。 - 记录源行号。

不负责： - 角色坐标。 - 场景布局。 - 人物素材绘制。 - 分镜推理。 -
动画时长最终排布。 - TTS。

解析器必须是纯逻辑模块，给定相同输入必须返回相同结果。

### 5.4 Draft / Import Module

将 `ScriptDraft` 转换成可编辑的动画草稿。

职责： - 角色名称映射为角色实例 ID。 - 根据场景模板创建场景实例。 -
根据场景锚点初始化人物位置。 - 绑定人物素材或占位素材。 -
将对白转换成事件。 - 保存来源信息和行号。

解析器与动画项目模型之间必须存在这一层，不能让解析器直接操作 PixiJS
对象。

### 5.5 Animation Editor Module

负责： - 画布选中和拖动。 - 人物位置编辑。 - 姿态修改。 - 道具编辑。 -
对白编辑。 - 时间轴编辑。 - 撤销/重做。 - 自动保存。

所有用户修改应通过可追踪的命令或状态更新完成，避免组件私自修改深层对象。

### 5.6 Animation Core

负责： - 按帧计算场景状态。 - 计算人物姿态。 - 计算人物位置。 -
计算对白是否播放。 - 计算嘴型状态。 - 计算字幕可见性。 - 提供确定性的
`getStateAtFrame(frame)`。

不依赖 React 组件状态，不依赖浏览器播放时钟。

### 5.7 TTS Module

定义统一 Provider 接口。每条对白生成独立音频资产，并返回真实时长。

不同 TTS 服务的参数差异必须封装在 Provider 内，不得散落到 UI
和动画引擎。

### 5.8 Render Module

负责： - 验证渲染输入。 - 计算总帧数。 - 使用共享动画核心逐帧渲染。 -
生成视频。 - 合成音频。 - 记录任务状态和错误。

## 6. 核心数据模型

### 6.1 Project

``` typescript
interface Project {
  id: string;
  name: string;
  version: number;
  fps: 30;
  width: 1080;
  height: 1920;
  sceneIds: string[];
  createdAt: string;
  updatedAt: string;
}
```

### 6.2 ScriptDraft

``` typescript
type Posture = "standing" | "sitting";

interface ParseError {
  line: number;
  column?: number;
  type: "syntax" | "character" | "posture" | "scene" | "limit";
  message: string;
}

interface DraftCharacter {
  id: string;
  name: string;
  initialPosture: Posture;
  sourceLine: number;
}

interface DraftDialogue {
  id: string;
  characterId: string;
  text: string;
  posture: Posture;
  sequence: number;
  sourceLine: number;
}

interface DraftScene {
  id: string;
  name: string;
  characters: DraftCharacter[];
  dialogues: DraftDialogue[];
}

interface ScriptDraft {
  scenes: DraftScene[];
  errors: ParseError[];
  warnings: string[];
}
```

### 6.3 Character Instance

``` typescript
interface CharacterInstance {
  id: string;
  assetId: string;
  name: string;
  x: number;
  y: number;
  posture: Posture;
  visible: boolean;
  zIndex: number;
  voiceId?: string;
  speed: number;
}
```

### 6.4 Dialogue Event

``` typescript
interface DialogueEvent {
  id: string;
  characterId: string;
  text: string;
  posture: Posture;
  startFrame: number;
  durationFrames: number;
  audioAssetId?: string;
  sourceLine?: number;
}
```

### 6.5 Scene Project Data

``` typescript
interface SceneProjectData {
  id: string;
  name: string;
  backgroundAssetId: string;
  characters: CharacterInstance[];
  props: PropInstance[];
  dialogueEvents: DialogueEvent[];
  durationFrames: number;
}
```

以上是逻辑示例。实际实现时应使用 Zod Schema 作为运行时校验来源，并从
Schema 推导 TypeScript 类型，避免类型和校验规则漂移。

## 7. 时间与动画计算

### 7.1 时间单位

项目 FPS 固定默认 30。核心时间统一使用整数帧：

`frame = seconds × fps`

秒数只用于展示、TTS 输入输出和音频元数据转换。

### 7.2 确定性要求

必须提供类似接口：

``` typescript
interface AnimationEvaluator {
  getStateAtFrame(
    project: AnimationProject,
    sceneId: string,
    frame: number
  ): AnimationFrameState;
}
```

要求： - 相同项目数据和帧编号得到相同状态。 - 可以任意跳帧。 -
不依赖上一帧的运行结果。 - 不依赖 `requestAnimationFrame`
的实际调用间隔。 - 不使用随机数产生关键动画状态，除非随机种子被保存。

### 7.3 人物姿态切换

人物位置使用逻辑锚点坐标。素材描述文件提供每个姿态的锚点。渲染时通过锚点转换图片显示位置，避免站姿和坐姿切换时跳动。

### 7.4 嘴型

第一版根据对白事件和音频时间计算
`isSpeaking`。嘴型可以由确定性循环或音频分析结果驱动。若使用音频分析，分析结果应缓存为可重复使用的数据，不应在每帧临时执行不可预测的计算。

## 8. PixiJS 与 Remotion 共享逻辑

禁止实现两套互不相关的动画逻辑。

推荐： - `animation-core` 负责纯数据计算。 - PixiJS Adapter 将
`AnimationFrameState` 转换为 PixiJS 显示对象。 - Remotion Adapter
将同一个 `AnimationFrameState` 转换为视频帧画面。

PixiJS 和 Remotion
可以有不同的绘制适配代码，但人物位置、姿态、对白状态、嘴型和字幕时序必须来自同一套核心计算。

## 9. TTS 数据流

``` text
对白文本
   ↓
TTS Provider
   ↓
音频文件 + 真实时长
   ↓
Audio Asset Metadata
   ↓
Dialogue Event 更新
   ↓
Animation Core
   ↓
嘴型与字幕时序
```

音频资产至少记录： - id - 文件路径 - durationMs - sampleRate -
channels - format - voiceId - speed - sourceDialogueId - createdAt

TTS
重新生成时应创建新资产或安全替换，并更新引用；不能留下指向旧文件的悬空引用。

## 10. 文件和数据库职责

SQLite 存储： - 项目列表。 - 项目路径。 - 项目创建和修改时间。 -
用户设置。 - 渲染任务元数据。

文件系统存储： - 项目 JSON。 - 原始剧本。 - 解析草稿。 -
人物和场景素材。 - TTS 音频。 - 渲染输出。

不要把大体积图片、音频和视频直接存进 SQLite。

建议项目目录：

``` text
data/projects/<project-id>/
├── project.json
├── scripts/
│   ├── original.txt
│   └── parsed-draft.json
├── animation/
│   └── animation.json
├── audio/
├── renders/
└── references.json
```

原始剧本、解析草稿和用户最终动画数据必须分开保存。

## 11. 重新解析和用户修改保护

流程： 1. 保存原始剧本。 2. 解析生成新草稿。 3. 与当前动画数据比较。 4.
显示可能受影响的角色、对白和场景。 5. 用户确认后才应用。 6.
未确认前不修改当前动画数据。

第一版可以先实现"保留旧数据并确认整体替换"，不必一开始实现复杂字段级自动合并。

## 12. API 规划

  路径                       方法   职责
  -------------------------- ------ --------------
  `/api/projects`            GET    项目列表
  `/api/projects`            POST   创建项目
  `/api/projects/:id`        GET    读取项目
  `/api/projects/:id`        PUT    保存项目
  `/api/scripts/parse`       POST   解析剧本
  `/api/assets/characters`   GET    人物素材列表
  `/api/assets/scenes`       GET    场景素材列表
  `/api/assets/props`        GET    道具素材列表
  `/api/tts/generate`        POST   生成对白音频
  `/api/render`              POST   创建渲染任务
  `/api/render/:id`          GET    查询渲染状态

API 输入输出必须使用共享 Schema 校验。渲染任务应返回任务
ID，前端通过查询或受控事件更新状态。

## 13. 错误和日志

统一错误分类： - `VALIDATION_ERROR` - `SCRIPT_PARSE_ERROR` -
`ASSET_NOT_FOUND` - `TTS_FAILED` - `RENDER_FAILED` - `PROJECT_IO_ERROR`

错误信息应包含可定位上下文，但不得向用户泄露敏感系统路径或内部堆栈。开发环境记录详细堆栈，生产界面显示可理解的错误和重试建议。

## 14. 测试策略

### 单元测试

-   剧本解析。
-   姿态继承。
-   角色数量限制。
-   Schema 校验。
-   帧数换算。
-   动画状态计算。
-   锚点位置计算。

### 集成测试

-   创建项目并保存。
-   解析剧本并生成草稿。
-   修改人物位置并保存。
-   生成 TTS 并更新时长。
-   创建渲染任务。

### 端到端测试

使用 PRD 中的老王和小李验收剧本，验证从剧本输入到 MP4 输出的完整流程。

## 15. 性能和资源要求

-   图片按需加载和缓存。
-   时间轴拖动时避免全项目无差别重渲染。
-   大型项目保存应避免频繁重复写入。
-   渲染任务与网页交互解耦。
-   渲染失败保留项目数据。
-   对素材尺寸和文件格式做基础校验。

## 16. 架构决策记录

### ADR-001：第一版不使用 LLM

原因：剧本语法受控，人物和姿态范围有限，固定解析更稳定、可测试、成本低。

### ADR-002：最多 4 个角色

原因：控制第一版场景布局和编辑复杂度。限制集中定义，未来可配置扩展。

### ADR-003：只支持站立和坐着

原因：先验证完整生产流程，不在第一版建设复杂动作系统。

### ADR-004：时间轴以帧为单位

原因：保证预览和视频渲染的确定性。

### ADR-005：PixiJS 预览、Remotion 导出，共享动画核心

原因：避免预览和最终视频出现行为不一致。

### ADR-006：模块化单体

原因：第一版开发和部署简单，模块边界清晰，未来有需要再拆分。

## 17. 实施顺序

1.  仓库检查、基础框架和项目管理。
2.  PixiJS 画布、坐标和静态素材。
3.  人物素材和姿态切换。
4.  独立剧本解析器及测试。
5.  动画草稿导入和工作台编辑。
6.  时间轴、保存、撤销重做。
7.  TTS、嘴型和字幕。
8.  Remotion、FFmpeg 和 MP4 导出。

每个阶段都应通过 PRD 对应验收后再继续。
