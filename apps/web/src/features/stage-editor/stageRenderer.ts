import {
  characterFrame,
  resolveCharacterLayers,
  safeAreaRect,
  type AnimationFrameState,
  type CharacterFrameState,
  type Viewport,
} from '@animation/animation-core';
import {
  PROJECT_DEFAULTS,
  STAGE_VIEWPORT,
  type Asset,
  type CharacterAsset,
  type CharacterInstance,
  type StageObject,
  type StageScene,
} from '@animation/shared';
import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { assetFileUrl, characterLayerUrl } from '../../lib/api';
import { boundsFor } from './layerGeometry';

/**
 * PixiJS 显示适配层（架构 8 节）：只把「舞台数据 + 视口」转换为显示对象。
 * 坐标转换、姿态锚点校准、层选择、命中测试全部来自 animation-core 纯函数，
 * 本文件不包含任何业务规则，也不反向修改项目数据。
 */
export interface RenderInput {
  scene: StageScene;
  assets: Asset[];
  /** 校验通过的人物描述文件，阶段 3 起用于分层渲染。 */
  characters: CharacterAsset[];
  viewport: Viewport;
  selectedId: string | null;
  showSafeArea: boolean;
  /**
   * 阶段 6：播放 / 跳帧时由 getStateAtFrame 计算的帧状态。
   * 为 null 时显示静态编辑态；非 null 时覆盖人物姿态、眼睛与嘴型。
   */
  frameState: AnimationFrameState | null;
}

export interface StageRendererHandle {
  resize: (width: number, height: number) => void;
  update: (input: RenderInput) => void;
  destroy: () => void;
}

const LOGICAL = { width: PROJECT_DEFAULTS.width, height: PROJECT_DEFAULTS.height };
const CANVAS_FILL = 0xf3efe6;
const PLACEHOLDER_TINT = 0x3a4250;

interface DisplayProps {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  anchorX?: number;
  anchorY?: number;
}

type RenderEntry =
  | { kind: 'prop'; zIndex: number; visible: boolean; object: StageObject }
  | {
      kind: 'character';
      zIndex: number;
      visible: boolean;
      instance: CharacterInstance;
      asset: CharacterAsset | null;
    };

export async function createStageRenderer(
  host: HTMLElement,
  width: number,
  height: number,
  onTextureReady: () => void,
): Promise<StageRendererHandle> {
  const app = new Application();
  await app.init({
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
    backgroundColor: 0x15171b,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  host.appendChild(app.canvas);

  const world = new Container();
  const canvasBackground = new Graphics();
  const backgroundLayer = new Container();
  const objectLayer = new Container();
  const overlayLayer = new Container();
  world.addChild(canvasBackground, backgroundLayer, objectLayer, overlayLayer);
  app.stage.addChild(world);

  /** key 对场景/道具是 assetId，对人物层是 `${characterId}:${layerFile}`。 */
  const textures = new Map<string, Texture>();
  const failed = new Set<string>();
  const pending = new Set<string>();
  let destroyed = false;

  function loadTexture(key: string, url: string): void {
    if (textures.has(key) || failed.has(key) || pending.has(key)) return;
    pending.add(key);
    void Assets.load<unknown>(url)
      .then((result) => {
        if (destroyed) return;
        // SVG loader / texture loader 都必须返回 Texture 实例才可使用。
        if (result instanceof Texture) textures.set(key, result);
        else failed.add(key);
      })
      .catch(() => {
        if (!destroyed) failed.add(key);
      })
      .finally(() => {
        pending.delete(key);
        if (!destroyed) onTextureReady();
      });
  }

  function createDisplay(asset: Asset | null, props: DisplayProps): Container {
    const texture = asset ? textures.get(asset.id) : undefined;
    const anchorX = props.anchorX ?? asset?.anchorX ?? 0.5;
    const anchorY = props.anchorY ?? asset?.anchorY ?? 1;
    const group = new Container();

    const sprite = new Sprite(texture ?? Texture.WHITE);
    sprite.anchor.set(anchorX, anchorY);
    sprite.width = props.width;
    sprite.height = props.height;
    sprite.tint = texture ? 0xffffff : PLACEHOLDER_TINT;
    group.addChild(sprite);

    if (!texture) {
      const missing = asset ? failed.has(asset.id) : true;
      group.addChild(
        new Graphics()
          .rect(-props.width * anchorX, -props.height * anchorY, props.width, props.height)
          .stroke({
            width: 3,
            color: missing ? 0xe45d5d : 0x5b8def,
            alpha: 0.9,
          }),
      );
    }

    group.position.set(props.x, props.y);
    group.rotation = ((props.rotation ?? 0) * Math.PI) / 180;
    return group;
  }

  /** 人物按当前姿态 / 眼睛 / 嘴型挑选分层纹理，整体位置由锚点校准。 */
  function createCharacterDisplay(
    instance: CharacterInstance,
    asset: CharacterAsset,
    frameCharacter?: CharacterFrameState,
  ): Container {
    // 帧状态优先：说话时按对白事件切换姿态、按整数帧循环嘴型；
    // 静态编辑态仍使用实例上人工设置的姿态与状态。
    const definition = asset.descriptor.postures[frameCharacter?.posture ?? instance.posture];
    const frame = characterFrame(instance, definition);
    const layers = resolveCharacterLayers(
      { width: instance.width },
      definition,
      frameCharacter?.eyeState ?? instance.eyeState,
      frameCharacter?.mouthState ?? instance.mouthState,
    );
    const group = new Container();
    group.position.set(frame.originX, frame.originY);

    for (const layer of layers) {
      const key = `${instance.assetId}:${layer.file}`;
      loadTexture(key, characterLayerUrl(instance.assetId, layer.file));
      const texture = textures.get(key);
      const sprite = new Sprite(texture ?? Texture.WHITE);
      sprite.anchor.set(0, 0);
      sprite.position.set(layer.x, layer.y);
      sprite.width = layer.width;
      sprite.height = layer.height;
      sprite.tint = texture ? 0xffffff : PLACEHOLDER_TINT;
      group.addChild(sprite);

      if (!texture) {
        group.addChild(
          new Graphics()
            .rect(layer.x, layer.y, layer.width, layer.height)
            .stroke({
              width: 3,
              color: failed.has(key) ? 0xe45d5d : 0x5b8def,
              alpha: 0.9,
            }),
        );
      }
    }
    return group;
  }

  function clearLayer(layer: Container): void {
    for (const child of layer.removeChildren()) {
      child.destroy({ children: true });
    }
  }

  function update(input: RenderInput): void {
    const { scene, assets, characters, viewport, selectedId, showSafeArea, frameState } = input;
    const lineWidth = 2 / viewport.scale;
    const frameCharacters = new Map(
      (frameState?.characters ?? []).map((item) => [item.id, item]),
    );

    world.scale.set(viewport.scale);
    world.position.set(viewport.offsetX, viewport.offsetY);

    canvasBackground
      .clear()
      .rect(0, 0, LOGICAL.width, LOGICAL.height)
      .fill({ color: CANVAS_FILL })
      .rect(0, 0, LOGICAL.width, LOGICAL.height)
      // 画布边界使用中性灰，蓝色只保留给选中框与安全区，避免语义混淆。
      .stroke({ width: lineWidth, color: 0x9aa3b2, alpha: 0.6 });

    clearLayer(backgroundLayer);
    const background = scene.backgroundAssetId
      ? (assets.find((item) => item.id === scene.backgroundAssetId) ?? null)
      : null;
    if (background) {
      loadTexture(background.id, assetFileUrl(background.id));
      backgroundLayer.addChild(
        createDisplay(background, {
          x: 0,
          y: 0,
          width: LOGICAL.width,
          height: LOGICAL.height,
          anchorX: 0,
          anchorY: 0,
        }),
      );
    }

    // 道具与人物共用一条 zIndex 序列，保证「上移一层」在混合场景下也正确。
    const entries: RenderEntry[] = [
      ...scene.objects.map((object) => ({
        kind: 'prop' as const,
        zIndex: object.zIndex,
        visible: object.visible,
        object,
      })),
      ...scene.characters.map((instance) => ({
        kind: 'character' as const,
        zIndex: instance.zIndex,
        visible: instance.visible,
        instance,
        asset: characters.find((item) => item.id === instance.assetId) ?? null,
      })),
    ].sort((a, b) => a.zIndex - b.zIndex);

    clearLayer(objectLayer);
    for (const entry of entries) {
      if (!entry.visible) continue;
      if (entry.kind === 'prop') {
        const object = entry.object;
        const asset = assets.find((item) => item.id === object.assetId) ?? null;
        if (asset) loadTexture(asset.id, assetFileUrl(asset.id));
        objectLayer.addChild(
          createDisplay(asset, {
            x: object.x,
            y: object.y,
            width: object.width,
            height: object.height,
            rotation: object.rotation,
            anchorX: asset?.anchorX,
            anchorY: asset?.anchorY,
          }),
        );
        continue;
      }

      const { instance, asset } = entry;
      if (!asset) {
        // 描述文件不可用时显示明确占位，不伪造人物画面。
        const fallback = characterFrame(
          { x: instance.x, y: instance.y, width: instance.width },
          { size: { width: 360, height: 600 }, anchor: { x: 180, y: 600 }, layers: [] },
        );
        objectLayer.addChild(
          createDisplay(null, {
            x: instance.x,
            y: instance.y,
            width: fallback.width,
            height: fallback.height,
            anchorX: fallback.anchorX,
            anchorY: fallback.anchorY,
          }),
        );
        continue;
      }
      objectLayer.addChild(
        createCharacterDisplay(instance, asset, frameCharacters.get(instance.id)),
      );
    }

    clearLayer(overlayLayer);
    if (showSafeArea) {
      const area = safeAreaRect(LOGICAL, STAGE_VIEWPORT.safeAreaRatio);
      overlayLayer.addChild(
        new Graphics()
          .rect(area.x, area.y, area.width, area.height)
          .stroke({ width: lineWidth, color: 0x5b8def, alpha: 0.45 }),
      );
    }

    const selectedObject = scene.objects.find((item) => item.id === selectedId && item.visible);
    const selectedCharacter = scene.characters.find((item) => item.id === selectedId && item.visible);
    const activeSelectedId = selectedObject?.id ?? selectedCharacter?.id;
    if (activeSelectedId) {
      const bounds = boundsFor(scene, activeSelectedId, assets, characters);
      if (bounds) {
        const pad = 6 / viewport.scale;
        const handle = 8 / viewport.scale;
        const frame = new Graphics()
          .rect(bounds.x - pad, bounds.y - pad, bounds.width + pad * 2, bounds.height + pad * 2)
          .stroke({ width: lineWidth, color: 0x5b8def });
        for (const [cx, cy] of [
          [bounds.x - pad, bounds.y - pad],
          [bounds.x + bounds.width + pad, bounds.y - pad],
          [bounds.x - pad, bounds.y + bounds.height + pad],
          [bounds.x + bounds.width + pad, bounds.y + bounds.height + pad],
        ]) {
          frame.circle(cx, cy, handle / 2).fill({ color: 0xffffff }).stroke({ width: lineWidth, color: 0x5b8def });
        }
        overlayLayer.addChild(frame);
      }
    }

    // 诊断属性：已加载纹理数 / 加载失败数，便于确认素材真的渲染而非占位。
    host.dataset.stageTextures = `${textures.size}/${failed.size}`;
  }

  return {
    resize: (nextWidth, nextHeight) => {
      app.renderer.resize(Math.max(1, Math.floor(nextWidth)), Math.max(1, Math.floor(nextHeight)));
    },
    update,
    destroy: () => {
      destroyed = true;
      textures.clear();
      failed.clear();
      pending.clear();
      app.destroy({ removeView: true }, { children: true });
    },
  };
}
