# animation-video

Web 端 2D 段子动画制作工具。用户编写固定格式的剧本，程序用确定性规则解析出场景、角色、对白和姿态，生成动画草稿；随后在网页工作台中编辑人物素材、位置、姿态、对白和时间轴，再生成 TTS 配音、字幕，最终导出 MP4 视频。

> 本项目**不使用 LLM / AI 剧本分析**，所有解析结果均由固定语法规则推导，相同输入必然产生相同结果。

## 功能特性

- **项目管理**：创建、打开、保存、删除动画项目（SQLite 索引 + 文件系统存储项目 JSON 与素材）。
- **剧本编辑与解析**：Monaco 剧本编辑器，固定语法解析场景 / 角色 / 对白 / 姿态，错误提示带原始行号。
- **动画工作台**：PixiJS 8 中央画布，人物可拖动定位，支持场景背景与静态道具；每场景最多 4 个角色。
- **姿态与嘴型**：`standing`（站着）/ `sitting`（坐着）两种姿态，锚点校准切换；说话时简单嘴型图片切换。
- **时间轴编辑**：对白轨道、角色姿态轨道、音频轨道，事件块拖拽调整，核心时间单位为整数帧（默认 30 FPS）。
- **TTS 配音**：统一 TTS 接口，每句对白独立生成音频，并根据音频实际时长自动更新对白时间轴；支持本地离线引擎（Kokoro Thai ONNX）与可选的在线引擎（edge-tts，需明确同意后启用）。
- **字幕**：对白自动生成字幕并随时间轴显示。
- **动画预览**：网页内实时预览，与导出共用同一套动画数据和帧状态计算逻辑。
- **MP4 导出**：基于 Remotion 逐帧渲染 + FFmpeg 音视频合成。

第一版明确不做：AI 视频生成、复杂骨骼动画、3D、多人同时说话、自动推断情绪/动作/坐标。详见 `docs/PRD.md`。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 UI | React 19 + TypeScript (strict) + Vite 7 |
| 样式 | Tailwind CSS（深色创作软件风格） |
| 状态管理 | Zustand |
| 画布 | PixiJS 8 |
| 剧本编辑器 | Monaco Editor |
| 后端 | Fastify 5 (Node.js, tsx 运行) |
| 数据 | SQLite（元数据）+ 本地文件系统（项目/素材/音视频） |
| 视频渲染 | Remotion + FFmpeg |
| 校验 / 测试 | Zod + Vitest |

## 环境要求

- **Node.js ≥ 22.5.0**（npm workspaces monorepo）
- **FFmpeg**：需要安装在系统 PATH 中（TTS 音频转码与 MP4 合成均依赖）
- 浏览器：桌面 Chrome / Edge（设计基准 1440 × 900，最小 1200 × 700）

## 快速开始

```bash
# 1. 安装依赖（仓库根目录执行，workspace 会一并安装所有子包）
npm install

# 2. 同时启动后端服务与前端开发服务器
npm run dev
```

启动后：

- 前端（Web UI）：<http://127.0.0.1:4001>
- 后端 API：<http://127.0.0.1:4002>（前端开发服务器已将 `/api` 代理到该地址）

## 常用命令

在仓库根目录执行：

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 同时启动后端（tsx watch，端口 4002）和前端（Vite，端口 4001） |
| `npm run dev:server` | 只启动后端服务 |
| `npm run dev:web` | 只启动前端开发服务器 |
| `npm start` | 生产方式启动后端服务（tsx 直跑，无 watch） |
| `npm run build` | 先类型检查，再构建前端产物 |
| `npm run typecheck` | TypeScript 类型检查（不产出文件） |
| `npm test` | 运行 Vitest 单元测试（单次） |
| `npm run test:watch` | Vitest 监听模式 |

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `4002` | 后端服务端口 |
| `HOST` | `127.0.0.1` | 后端监听地址 |
| `ANIMATION_DATA_DIR` | `<仓库根>/data` | 数据目录（SQLite 库与项目文件存放位置） |
| `ANIMATION_TTS_PROVIDERS_FILE` | 不设置 | 外部 TTS 引擎配置文件路径；不设置时保持纯离线 |

## TTS 配置（可选）

`config/tts-providers.example.json` 是外部 TTS 引擎的配置示例：

- 默认**不加载**。只有设置 `ANIMATION_TTS_PROVIDERS_FILE` 指向该文件时，服务端才会注册其中的外部引擎。
- 支持本地离线引擎（示例为 Kokoro Thai ONNX，`kind: "command"` 调用本机 Python 脚本 `apps/server/scripts/kokoro_thai.py`）。
- 在线引擎（如 edge-tts 中文）默认放在 `disabledProviders` 中，启用前必须征得用户明确同意（台词会发送到公网服务）。
- 密钥不要写进配置文件，使用 `{env:VAR_NAME}` 从进程环境读取。
- 非 WAV 产物会经 ffmpeg 统一转成 PCM16 单声道 WAV。

## 剧本语法速览

```text
# 场景：客厅
# 角色：老王、小李
老王（坐着）：你回来了？
小李（站着）：我的蛋糕呢？
老王：我不知道啊。
```

规则要点：

- `# 场景：名称` 声明场景，支持多场景顺序播放。
- `# 角色：A、B` 声明角色（中英文逗号均可），每场景最多 4 个，未声明的角色不能出现在对白中。
- 对白格式为 `角色名（姿态）：对白内容`；姿态可省略，省略时沿用该角色最近一次姿态，首次出现默认站立。
- 姿态只支持 `站着` / `坐着`，其他姿态报错（不会猜测）。
- 空行忽略，对白内容不得为空；一行即一条对白事件，错误提示带原始行号。

## 项目结构

```text
animation-2d/
├── apps/
│   ├── server/          # Fastify 后端：API（projects/scripts/stage/assets/tts/render/settings）、
│   │                    #   渲染服务（Remotion + FFmpeg）、SQLite 仓储层
│   └── web/             # React 前端：项目首页 / 剧本页 / 动画工作台 / 素材管理 / 设置
├── packages/
│   ├── animation-core/  # 动画核心：帧状态计算、姿态锚点、对白时间、嘴型与字幕区间（预览与导出共用）
│   ├── script-parser/   # 剧本解析器：固定语法、规则校验、姿态继承（不操作 PixiJS 对象）
│   └── shared/          # 前后端共享类型与 Zod Schema
├── config/              # TTS providers 配置示例
├── data/                # 运行时数据：workbench.sqlite + projects/（可由 ANIMATION_DATA_DIR 重定向）
├── docs/                # PRD.md（产品需求）、ARCHITECTURE.md（技术架构）
├── scripts/_uicheck/    # 验收/UI 检查脚本与产物
├── AGENTS.md            # AI 开发约束（开发前必读）
└── vitest.config.ts     # 测试配置
```

## 核心工作流程

1. **新建项目**：在项目首页创建动画项目。
2. **编写剧本**：在剧本页按固定语法输入剧本，点击「解析剧本」，查看场景 / 角色 / 对白 / 姿态及错误提示。
3. **创建动画草稿**：确认解析结果后生成场景、人物和对白事件。
4. **工作台编辑**：调整场景、人物素材、位置（拖动为主）、姿态、对白和时间轴。
5. **生成配音**：为每句对白生成 TTS 音频，时间轴按音频实际时长更新。
6. **预览**：在网页中实时预览动画。
7. **导出 MP4**：Remotion 逐帧渲染并合成音视频，导出最终视频。

原始剧本、解析草稿和最终动画数据分开保存；重新解析不会静默覆盖用户编辑成果。

## 开发说明

- TypeScript 全量 strict，API 输入输出使用共享 Zod Schema 校验。
- 动画核心逻辑（`packages/animation-core`）与 PixiJS 显示适配、Remotion 渲染适配分离，预览与导出共用同一套状态计算。
- 剧本解析与动画核心的关键规则均有 Vitest 测试覆盖（姿态继承、角色超限、帧状态、字幕区间等）。
- 开发约束与交付规范见 `AGENTS.md`，产品细节见 `docs/PRD.md`，模块边界与数据流见 `docs/ARCHITECTURE.md`。
