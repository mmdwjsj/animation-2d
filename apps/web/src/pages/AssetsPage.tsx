import {
  ASSET_KIND_LABELS,
  CHARACTER_LAYER_ROLE_LABELS,
  MAX_CHARACTERS_PER_SCENE,
  POSTURE_LABELS,
  POSTURE_VALUES,
  PROJECT_DEFAULTS,
  type Asset,
  type AssetStatus,
  type CharacterAsset,
} from '@animation/shared';
import { useEffect, useState } from 'react';
import Button from '../components/Button';
import CharacterPreview from '../features/stage-editor/CharacterPreview';
import { assetFileUrl, assetsApi, charactersApi, getErrorMessage } from '../lib/api';

/**
 * 素材管理页：展示仓库内真实的静态素材索引、分层人物描述与缺失检测结果。
 * 所有内容来自文件系统与 character.json，不展示示例数据或占位人物。
 */
export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [characters, setCharacters] = useState<CharacterAsset[] | null>(null);
  const [status, setStatus] = useState<AssetStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([assetsApi.list(), assetsApi.status(), charactersApi.list()])
      .then(([list, nextStatus, characterList]) => {
        if (cancelled) return;
        setAssets(list);
        setStatus(nextStatus);
        setCharacters(characterList);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(getErrorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const scenes = assets?.filter((asset) => asset.kind === 'scene') ?? [];
  const props = assets?.filter((asset) => asset.kind === 'prop') ?? [];
  const missing = new Set(status?.missing ?? []);

  return (
    <div className="mx-auto max-w-[980px] px-8 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">素材管理</h1>
          <p className="mt-2 text-sm text-muted">
            素材库与项目实例分离，项目通过稳定的素材 ID 引用。以下列表来自真实索引与文件系统扫描。
          </p>
        </div>
        <Button onClick={() => setReloadKey((key) => key + 1)}>刷新</Button>
      </div>

      {error && (
        <div className="mt-6 rounded border border-danger bg-panel px-4 py-3 text-sm text-danger">
          素材库读取失败：{error}
        </div>
      )}

      {!assets && !error && (
        <div className="mt-8 rounded border border-line bg-panel px-4 py-10 text-center text-sm text-muted">
          正在读取素材索引…
        </div>
      )}

      {assets && (
        <>
          <section className="mt-6 grid grid-cols-3 gap-3">
            <StatCard label="素材总数" value={String(status?.total ?? assets.length)} />
            <StatCard
              label="缺失文件"
              value={String(status?.missing.length ?? 0)}
              danger={(status?.missing.length ?? 0) > 0}
            />
            <StatCard
              label="画布逻辑尺寸"
              value={`${PROJECT_DEFAULTS.width} × ${PROJECT_DEFAULTS.height}`}
            />
          </section>

          {status && status.missing.length > 0 && (
            <div className="mt-4 whitespace-pre-wrap break-all rounded border border-danger bg-panel px-4 py-3 text-xs leading-6 text-danger">
              以下素材或分层文件缺失，画布中会显示占位图：{status.missing.join('、')}
            </div>
          )}

          <AssetSection
            title={`${ASSET_KIND_LABELS.scene}背景`}
            description="点击工作台左侧「场景」Tab 可应用到当前场景。"
            assets={scenes}
            missing={missing}
          />
          <AssetSection
            title={ASSET_KIND_LABELS.prop}
            description="可在工作台拖入画布，支持位置、尺寸与图层调整。"
            assets={props}
            missing={missing}
          />

          <section className="mt-6">
            <h2 className="section-title">
              {ASSET_KIND_LABELS.character}素材（{characters?.length ?? 0}）
            </h2>
            <p className="mt-1.5 text-xs leading-6 text-muted">
              分层 SVG 素材由 character.json 描述文件统一适配运行时，姿态仅支持站立 / 坐着，
              每场景最多 {MAX_CHARACTERS_PER_SCENE} 个角色。预览图由真实分层实时合成。
            </p>
            {characters && characters.length > 0 ? (
              <div className="mt-3 grid grid-cols-2 gap-3">
                {characters.map((character) => {
                  const standing = character.descriptor.postures.standing;
                  const sitting = character.descriptor.postures.sitting;
                  return (
                    <div key={character.id} className="panel-surface rounded-lg p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-ink">{character.name}</p>
                          <p className="mt-1 text-[11px] text-muted">素材 ID：{character.id}</p>
                          <p className="mt-1 text-[11px] text-muted">
                            局部画布 {standing.size.width} × {standing.size.height}
                          </p>
                          <p className="mt-1 text-[11px] text-muted">
                            每姿态 {standing.layers.length} 个分层
                          </p>
                          <p className="mt-1 text-[11px] leading-5 text-muted">
                            站立锚点 ({standing.anchor.x}, {standing.anchor.y}) · {standing.anchorLabel}
                            <br />
                            坐着锚点 ({sitting.anchor.x}, {sitting.anchor.y}) · {sitting.anchorLabel}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-3">
                          {POSTURE_VALUES.map((posture) => (
                            <div key={posture} className="text-center">
                              <div className="flex h-[120px] w-[72px] items-start justify-center overflow-hidden rounded bg-page">
                                <CharacterPreview
                                  character={character}
                                  posture={posture}
                                  className="w-[72px]"
                                />
                              </div>
                              <p className="mt-1 text-[11px] text-muted">{POSTURE_LABELS[posture]}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      <ul className="mt-3 grid grid-cols-2 gap-1">
                        {standing.layers.map((layer) => (
                          <li
                            key={`${layer.role}-${layer.variant ?? ''}`}
                            className="truncate rounded bg-page px-2 py-1 text-[11px] text-muted"
                            title={layer.file}
                          >
                            {CHARACTER_LAYER_ROLE_LABELS[layer.role]}
                            {layer.variant ? ` · ${layer.variant}` : ''}：{layer.file}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 rounded border border-dashed border-line bg-panel px-4 py-8 text-center text-xs text-muted">
                暂无可用人物素材，请检查 assets/characters 下的描述文件与分层文件
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="panel-surface rounded-lg px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${danger ? 'text-danger' : 'text-ink'}`}>{value}</p>
    </div>
  );
}

function AssetSection({
  title,
  description,
  assets,
  missing,
}: {
  title: string;
  description: string;
  assets: Asset[];
  missing: Set<string>;
}) {
  return (
    <section className="mt-6">
      <h2 className="section-title">{title}（{assets.length}）</h2>
      <p className="mt-1.5 text-xs text-muted">{description}</p>
      {assets.length === 0 ? (
        <div className="mt-3 rounded border border-dashed border-line bg-panel px-4 py-8 text-center text-xs text-muted">
          暂无该类型素材
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-3">
          {assets.map((asset) => (
            <AssetCard key={asset.id} asset={asset} missing={missing.has(asset.id)} />
          ))}
        </div>
      )}
    </section>
  );
}

function AssetCard({ asset, missing }: { asset: Asset; missing: boolean }) {
  return (
    <div className="panel-surface rounded-lg p-3">
      <div className="flex h-[130px] items-center justify-center overflow-hidden rounded bg-page">
        {missing || asset.kind === 'character' ? (
          <div className="flex h-[104px] w-[80px] flex-col items-center justify-center gap-1 rounded border border-danger text-[11px] text-danger">
            <span>{asset.kind === 'character' ? '见下方人物区' : '文件缺失'}</span>
            {asset.kind !== 'character' && <span>占位图</span>}
          </div>
        ) : (
          <img
            src={assetFileUrl(asset.id)}
            alt={asset.name}
            className={asset.kind === 'scene' ? 'h-[120px] w-[68px] object-contain' : 'max-h-[110px] max-w-[160px] object-contain'}
          />
        )}
      </div>
      <p className="mt-2 truncate text-sm text-ink" title={asset.name}>
        {asset.name}
        <span className="ml-2 text-[11px] text-muted">{asset.category}</span>
      </p>
      <dl className="mt-1.5 space-y-1 text-[11px]">
        <Row label="素材 ID" value={asset.id} />
        <Row label="尺寸" value={`${asset.width} × ${asset.height}`} />
        <Row label="锚点" value={`${asset.anchorX}, ${asset.anchorY}`} />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="truncate text-right text-ink" title={value}>
        {value}
      </dd>
    </div>
  );
}
