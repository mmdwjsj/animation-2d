import { PROJECT_DEFAULTS, type Asset, type StageScene } from '@animation/shared';
import { useMemo, useState, type ReactNode } from 'react';
import { assetFileUrl } from '../../lib/api';
import type { SceneEditFocus } from './SceneEditorModal';
import { MIN_SCENES } from './sceneOperations';
import { buildSceneTabItems, totalTabFrames, type SceneTabItem } from './sceneTabItems';

/** 场景拖拽使用独立的 MIME，避免与素材拖入画布的 ASSET_DRAG_MIME 混淆。 */
export const SCENE_DRAG_MIME = 'application/x-animation-scene';

interface SceneTabBarProps {
  scenes: readonly StageScene[];
  assets: readonly Asset[];
  /**
   * 实际编辑目标场景 id（来自 selectActiveScene），而不是原始 activeSceneId：
   * 旧项目的 animation.json 可能没有该字段，UI 高亮必须与画布、时间轴保持一致。
   */
  activeSceneId: string | null;
  loading: boolean;
  onSelect: (sceneId: string) => void;
  onAdd: () => void;
  /** 复制该场景（含对白、人物、道具与转场配置），插入到它后面。 */
  onDuplicate: (sceneId: string) => void;
  onMove: (sceneId: string, direction: 'left' | 'right') => void;
  onMoveTo: (sceneId: string, targetIndex: number) => void;
  /** 双击 Tab 或点击重命名：打开 PRD 7.3 的场景编辑。 */
  onEdit: (sceneId: string, focus: SceneEditFocus) => void;
  onDelete: (sceneId: string) => void;
}

const formatSeconds = (frames: number): string =>
  `${(frames / PROJECT_DEFAULTS.fps).toFixed(1)}s`;

/**
 * 工作台场景栏：切换 + 完整场景管理。
 *
 * 与左侧资源面板的「场景」Tab 是两件事：那里选的是背景素材，这里管理的是
 * stage.scenes 中的场景实例。顺序即导出拼接顺序，与服务端 buildSceneSpans 一致。
 * 所有操作都在一层可达（按钮 + 拖拽），不藏进多级菜单（AGENTS.md 5.5）。
 */
export default function SceneTabBar({
  scenes,
  assets,
  activeSceneId,
  loading,
  onSelect,
  onAdd,
  onDuplicate,
  onMove,
  onMoveTo,
  onEdit,
  onDelete,
}: SceneTabBarProps) {
  const items = useMemo(() => buildSceneTabItems(scenes, assets), [scenes, assets]);
  const totalFrames = totalTabFrames(items);
  const active = items.find((item) => item.sceneId === activeSceneId) ?? null;
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  return (
    <div
      data-testid="scene-tab-bar"
      className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-panel px-4"
    >
      <div className="flex shrink-0 items-center gap-2">
        <span className="section-title">场景</span>
        <span className="text-[10px] text-muted">按顺序播放 · 可拖拽调整</span>
      </div>

      <div
        data-testid="scene-tab-list"
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1"
      >
        {items.length === 0 && (
          <span className="shrink-0 text-xs text-muted">
            {loading ? '正在读取场景…' : '暂无场景，可新建场景或在剧本编辑页导入草稿'}
          </span>
        )}

        {items.map((item, index) => {
          const isActive = item.sceneId === activeSceneId;
          const isDragging = draggingId === item.sceneId;
          const isDropTarget = dragOverId === item.sceneId && !isDragging;
          return (
            <div
              key={item.sceneId}
              data-testid="scene-tab"
              data-scene-id={item.sceneId}
              data-active={isActive}
              data-index={index}
              data-draggable="true"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(SCENE_DRAG_MIME, item.sceneId);
                event.dataTransfer.effectAllowed = 'move';
                setDraggingId(item.sceneId);
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setDragOverId(null);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                if (draggingId && draggingId !== item.sceneId) {
                  setDragOverId((current) =>
                    current === item.sceneId ? current : item.sceneId,
                  );
                }
              }}
              onDragLeave={() =>
                setDragOverId((current) => (current === item.sceneId ? null : current))
              }
              onDrop={(event) => {
                event.preventDefault();
                const id = event.dataTransfer.getData(SCENE_DRAG_MIME) || draggingId;
                if (id) onMoveTo(id, index);
                setDraggingId(null);
                setDragOverId(null);
              }}
              className={`flex h-8 shrink-0 items-center rounded border transition-colors ${
                isActive
                  ? 'border-accent bg-elevated text-ink'
                  : 'border-line bg-page text-muted hover:border-accent hover:text-ink'
              } ${isDragging ? 'opacity-40' : ''} ${isDropTarget ? 'border-accent ring-1 ring-accent' : ''}`}
            >
              <button
                type="button"
                data-testid="scene-tab-select"
                aria-pressed={isActive}
                aria-label={`切换到场景 ${index + 1}：${item.name}（双击编辑场景）`}
                title={`${item.name} · 全局 ${formatSeconds(item.startFrame)}–${formatSeconds(item.endFrame)} · ${item.dialogueCount} 句对白\n双击打开场景编辑，可改名 / 换背景 / 调顺序`}
                onClick={() => onSelect(item.sceneId)}
                onDoubleClick={() => onEdit(item.sceneId, 'name')}
                className="flex h-full items-center gap-2 rounded-l px-2 text-xs"
              >
                <span className="tabular-nums text-[10px] text-muted">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <SceneThumb item={item} />
                <span className="max-w-[120px] truncate">{item.name}</span>
                <span className="tabular-nums text-[10px] text-muted">
                  {formatSeconds(item.durationFrames)}
                </span>
                {item.transitionDurationFrames > 0 && (
                  <span
                    data-testid="scene-transition-badge"
                    title={`进入转场：淡化 ${item.transitionDurationFrames} 帧（约 ${(item.transitionDurationFrames / PROJECT_DEFAULTS.fps).toFixed(1)} 秒）`}
                    className="rounded border border-accent px-1 text-[9px] leading-4 text-accent"
                  >
                    淡
                  </span>
                )}
              </button>

              <div className="flex h-full items-center gap-0.5 border-l border-line px-1">
                <MiniButton
                  testId="scene-move-left"
                  label={`前移场景「${item.name}」`}
                  disabled={index === 0}
                  onClick={() => onMove(item.sceneId, 'left')}
                >
                  ‹
                </MiniButton>
                <MiniButton
                  testId="scene-move-right"
                  label={`后移场景「${item.name}」`}
                  disabled={index === items.length - 1}
                  onClick={() => onMove(item.sceneId, 'right')}
                >
                  ›
                </MiniButton>
                <MiniButton
                  testId="scene-rename"
                  label={`重命名场景「${item.name}」`}
                  onClick={() => onEdit(item.sceneId, 'name')}
                >
                  ✎
                </MiniButton>
                <MiniButton
                  testId="scene-duplicate"
                  label={`复制场景「${item.name}」（含对白、人物、道具与转场配置）`}
                  onClick={() => onDuplicate(item.sceneId)}
                >
                  <span className="text-[10px] leading-none">复</span>
                </MiniButton>
                <MiniButton
                  testId="scene-delete"
                  label={
                    items.length <= MIN_SCENES
                      ? '至少保留一个场景，不能删除'
                      : `删除场景「${item.name}」`
                  }
                  disabled={items.length <= MIN_SCENES}
                  onClick={() => onDelete(item.sceneId)}
                >
                  ×
                </MiniButton>
              </div>
            </div>
          );
        })}

        <button
          type="button"
          data-testid="scene-add"
          title="在末尾新建一个空场景"
          onClick={onAdd}
          className="flex h-8 shrink-0 items-center gap-1 rounded border border-dashed border-line px-2 text-xs text-muted hover:border-accent hover:text-ink"
        >
          <span className="text-sm leading-none">＋</span> 新建场景
        </button>
      </div>

      {items.length > 0 && (
        <div
          data-testid="scene-tab-summary"
          className="flex shrink-0 flex-col items-end text-[10px] leading-4 text-muted"
        >
          <span>共 {items.length} 个场景 · 总时长 {formatSeconds(totalFrames)}</span>
          {active && (
            <span className="text-ink">
              当前第 {active.index + 1} 个 · 全局 {formatSeconds(active.startFrame)} 起
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Tab 内的一层操作按钮：常显、键盘可达、带明确禁用态。 */
function MiniButton({
  testId,
  label,
  disabled = false,
  onClick,
  children,
}: {
  testId: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex h-5 w-5 items-center justify-center rounded text-[13px] leading-none text-muted hover:bg-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/** 场景缩略图：直接复用背景素材文件；缺失或无背景显示明确占位（PRD 7.3）。 */
function SceneThumb({ item }: { item: SceneTabItem }) {
  const [failed, setFailed] = useState(false);
  const assetId = item.backgroundAssetId;
  const canShow = assetId !== null && !item.backgroundMissing && !failed;
  const problem = item.backgroundMissing || failed;

  return (
    <span
      aria-label={problem ? '背景素材缺失' : assetId ? '场景背景' : '无背景'}
      title={
        problem
          ? '背景素材缺失，请在素材页检查'
          : assetId
            ? '场景背景'
            : '无背景（纯色画布）'
      }
      className={`relative flex h-7 w-5 shrink-0 items-center justify-center overflow-hidden rounded-sm border ${
        problem ? 'border-warning' : 'border-line'
      } bg-subtle`}
    >
      {canShow && assetId ? (
        <img
          src={assetFileUrl(assetId)}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={`text-[10px] ${problem ? 'text-warning' : 'text-muted'}`}>
          {problem ? '!' : '—'}
        </span>
      )}
    </span>
  );
}
