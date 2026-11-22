import { MAX_CHARACTERS_PER_SCENE, MAX_STAGE_OBJECTS, type Asset, type CharacterAsset } from '@animation/shared';
import Button from '../../components/Button';
import { assetFileUrl } from '../../lib/api';
import CharacterPreview from './CharacterPreview';
import { ASSET_DRAG_MIME } from './constants';

export type ResourceTab = 'scene' | 'character' | 'prop';

interface ResourcePanelProps {
  activeTab: ResourceTab;
  onTabChange: (tab: ResourceTab) => void;
  sceneAssets: Asset[];
  propAssets: Asset[];
  characterAssets: CharacterAsset[];
  currentBackgroundId: string | null;
  onSetBackground: (assetId: string | null) => void;
  onAddProp: (assetId: string) => void;
  onAddCharacter: (assetId: string) => void;
  objectCount: number;
  characterCount: number;
  limitNotice: string | null;
  onClearLimitNotice: () => void;
}

const TABS: { key: ResourceTab; label: string }[] = [
  { key: 'scene', label: '场景' },
  { key: 'character', label: '人物' },
  { key: 'prop', label: '道具' },
];

/** 左侧资源面板（PRD 7.3）。素材来自真实索引，人物缩略图由分层素材实时合成。 */
export default function ResourcePanel({
  activeTab,
  onTabChange,
  sceneAssets,
  propAssets,
  characterAssets,
  currentBackgroundId,
  onSetBackground,
  onAddProp,
  onAddCharacter,
  objectCount,
  characterCount,
  limitNotice,
  onClearLimitNotice,
}: ResourcePanelProps) {
  const atLimit = objectCount >= MAX_STAGE_OBJECTS;
  const atCharacterLimit = characterCount >= MAX_CHARACTERS_PER_SCENE;

  return (
    <aside className="flex w-[240px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onTabChange(tab.key)}
            aria-pressed={activeTab === tab.key}
            className={`h-7 rounded px-3 text-xs ${
              activeTab === tab.key
                ? 'bg-elevated text-ink'
                : 'text-muted hover:bg-subtle hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'scene' && (
        <div className="flex-1 overflow-auto px-3 py-3">
          <p className="mb-2 text-[11px] leading-5 text-muted">
            点击背景素材仅替换当前场景的背景；切换场景请使用上方场景栏。
          </p>
          <button
            type="button"
            onClick={() => onSetBackground(null)}
            className={`mb-3 flex h-9 w-full items-center justify-center rounded border text-xs ${
              currentBackgroundId === null
                ? 'border-accent bg-elevated text-ink'
                : 'border-line bg-page text-muted hover:text-ink'
            }`}
          >
            无背景（纯色画布）
          </button>
          <div className="grid grid-cols-2 gap-2">
            {sceneAssets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => onSetBackground(asset.id)}
                title={`${asset.name} · ${asset.width} × ${asset.height}`}
                className={`rounded border p-1.5 text-left ${
                  currentBackgroundId === asset.id
                    ? 'border-accent bg-elevated'
                    : 'border-line bg-page hover:border-accent'
                }`}
              >
                <div className="flex h-[92px] items-center justify-center overflow-hidden rounded bg-subtle">
                  <img
                    src={assetFileUrl(asset.id)}
                    alt={asset.name}
                    className="h-[92px] w-[52px] object-contain"
                  />
                </div>
                <p className="mt-1.5 truncate text-xs text-ink">{asset.name}</p>
                <p className="text-[10px] text-muted">{asset.width} × {asset.height}</p>
              </button>
            ))}
          </div>
          {sceneAssets.length === 0 && (
            <p className="mt-4 text-center text-xs text-muted">暂无场景素材</p>
          )}
        </div>
      )}

      {activeTab === 'character' && (
        <div className="flex-1 overflow-auto px-3 py-3">
          <p className="mb-2 text-[11px] leading-5 text-muted">
            点击「添加」或拖到画布。已添加 {characterCount} / {MAX_CHARACTERS_PER_SCENE} 个角色。
          </p>
          {(limitNotice || atCharacterLimit) && (
            <div className="mb-2 flex items-start gap-2 rounded border border-warning bg-elevated px-2 py-1.5 text-[11px] leading-5 text-warning">
              <span className="flex-1">
                {limitNotice ??
                  `已达到每场景 ${MAX_CHARACTERS_PER_SCENE} 个角色上限，请先移除一个角色。`}
              </span>
              {limitNotice && (
                <button
                  type="button"
                  aria-label="关闭提示"
                  onClick={onClearLimitNotice}
                  className="shrink-0 text-ink"
                >
                  ×
                </button>
              )}
            </div>
          )}
          <div className="space-y-2">
            {characterAssets.map((asset) => (
              <div
                key={asset.id}
                draggable={!atCharacterLimit}
                onDragStart={(event) => {
                  event.dataTransfer.setData(ASSET_DRAG_MIME, asset.id);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                className={`flex items-center gap-2 rounded border border-line bg-page p-2 ${
                  atCharacterLimit
                    ? 'opacity-60'
                    : 'cursor-grab hover:border-accent active:cursor-grabbing'
                }`}
              >
                <div className="flex h-16 w-12 shrink-0 items-start justify-center overflow-hidden rounded bg-subtle">
                  <CharacterPreview character={asset} className="w-[38px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-ink">{asset.name}</p>
                  <p className="text-[10px] text-muted">站立 / 坐着</p>
                  <p className="text-[10px] text-muted">
                    {asset.descriptor.postures.standing.layers.length} 层素材
                  </p>
                </div>
                <Button
                  className="h-7 shrink-0 px-2 text-xs"
                  aria-label={`添加${asset.name}`}
                  disabled={atCharacterLimit}
                  onClick={() => onAddCharacter(asset.id)}
                >
                  添加
                </Button>
              </div>
            ))}
          </div>
          {characterAssets.length === 0 && (
            <p className="mt-4 text-center text-xs leading-6 text-muted">
              暂无可用人物素材
              <br />
              请检查 assets/characters 下的描述文件
            </p>
          )}
        </div>
      )}

      {activeTab === 'prop' && (
        <div className="flex-1 overflow-auto px-3 py-3">
          <p className="mb-2 text-[11px] leading-5 text-muted">
            点击「添加」或直接拖到画布。已放置 {objectCount} / {MAX_STAGE_OBJECTS} 个对象。
          </p>
          {atLimit && (
            <p className="mb-2 rounded border border-warning bg-elevated px-2 py-1.5 text-[11px] text-warning">
              已达到单场景对象上限，请先删除部分对象。
            </p>
          )}
          <div className="space-y-2">
            {propAssets.map((asset) => (
              <div
                key={asset.id}
                draggable={!atLimit}
                onDragStart={(event) => {
                  event.dataTransfer.setData(ASSET_DRAG_MIME, asset.id);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                className={`flex items-center gap-2 rounded border border-line bg-page p-2 ${
                  atLimit ? 'opacity-60' : 'cursor-grab hover:border-accent active:cursor-grabbing'
                }`}
              >
                <div className="flex h-12 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-subtle">
                  <img
                    src={assetFileUrl(asset.id)}
                    alt={asset.name}
                    className="max-h-10 w-12 object-contain"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-ink">{asset.name}</p>
                  <p className="text-[10px] text-muted">{asset.width} × {asset.height}</p>
                </div>
                <Button
                  className="h-7 shrink-0 px-2 text-xs"
                  aria-label={`添加${asset.name}`}
                  disabled={atLimit}
                  onClick={() => onAddProp(asset.id)}
                >
                  添加
                </Button>
              </div>
            ))}
          </div>
          {propAssets.length === 0 && (
            <p className="mt-4 text-center text-xs text-muted">暂无道具素材</p>
          )}
        </div>
      )}
    </aside>
  );
}
