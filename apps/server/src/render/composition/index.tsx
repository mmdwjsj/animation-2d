import type { CSSProperties, FC } from 'react';
import { AbsoluteFill, Composition, Img, registerRoot, useCurrentFrame } from 'remotion';
import {
  COMPOSITION_ID,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  frameAtFrame,
  type CompositionProps,
  type RenderFrameVisual,
  type RenderLayer,
} from './props';

/**
 * Remotion Adapter（架构 8 节）：把服务端预计算的 `AnimationFrameState` 绘制指令
 * 转成视频帧画面。人物位置、姿态、嘴型、字幕全部来自共享动画核心，
 * 这里不重复实现任何动画计算。
 *
 * 帧块化：inputProps 只携带状态变化处的帧块，frameAtFrame 按当前帧二分定位；
 * 场景间转场时把「上一场景定格」与「当前场景」作为两层叠加交叉淡化。
 */

function layerStyle(layer: RenderLayer): CSSProperties {
  return {
    position: 'absolute',
    left: layer.x,
    top: layer.y,
    width: layer.width,
    height: layer.height,
    transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
    transformOrigin: `${layer.anchorX * 100}% ${layer.anchorY * 100}%`,
  };
}

interface SceneVisualProps {
  visual: RenderFrameVisual;
  assets: Record<string, string>;
  logicalWidth: number;
  logicalHeight: number;
  /** 整层不透明度；转场时两层反向变化实现交叉淡化。 */
  opacity: number;
  /** 只有当前场景层暴露字幕测试锚点，避免转场期间出现两个同名节点。 */
  subtitleTestId?: string;
}

const SceneVisual: FC<SceneVisualProps> = ({
  visual,
  assets,
  logicalWidth,
  logicalHeight,
  opacity,
  subtitleTestId,
}) => {
  const background = visual.background ? assets[visual.background] : undefined;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: logicalWidth,
        height: logicalHeight,
        opacity,
        overflow: 'hidden',
      }}
    >
      {background ? (
        <Img
          src={background}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: logicalWidth,
            height: logicalHeight,
          }}
        />
      ) : null}

      {visual.layers.map((layer, index) => (
        <Img key={index} src={assets[layer.src]} style={layerStyle(layer)} />
      ))}

      {visual.subtitle ? (
        <div
          data-testid={subtitleTestId}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 120,
            display: 'flex',
            justifyContent: 'center',
            padding: '0 80px',
          }}
        >
          <div
            style={{
              maxWidth: '84%',
              background: 'rgba(12,14,18,0.78)',
              border: '2px solid rgba(255,255,255,0.18)',
              borderRadius: 12,
              padding: '14px 32px',
              color: '#F5F7FA',
              fontFamily:
                visual.subtitle.language === 'th'
                  ? '"Leelawadee UI", "Noto Sans Thai", "Tahoma", sans-serif'
                  : '"Microsoft YaHei", "PingFang SC", sans-serif',
              fontSize: 36,
              lineHeight: `${visual.subtitle.lineHeight}px`,
              textAlign: 'center',
              overflowWrap: 'anywhere',
            }}
          >
            {/* 断行由服务端预计算，这里只绘制；第一行与角色名同行。 */}
            {visual.subtitle.lines.map((line, index) => (
              <span key={index} style={{ display: index === 0 ? 'inline' : 'block' }}>
                {index === 0 && visual.subtitle?.characterName ? (
                  <span style={{ marginRight: 8, fontSize: 28, color: '#9AA3B2' }}>
                    {visual.subtitle.characterName}：
                  </span>
                ) : null}
                {line}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const SceneFrame: FC<CompositionProps> = (props) => {
  const current = useCurrentFrame();
  const frame = frameAtFrame(props, current);
  const scale = props.width / props.logicalWidth;
  const transition = frame?.transition ?? null;

  return (
    <AbsoluteFill style={{ backgroundColor: '#15171B' }}>
      {/* 内部固定 1080 × 1920 逻辑坐标，外层只做等比缩放，任意分辨率都不会错位。 */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: props.logicalWidth,
          height: props.logicalHeight,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          overflow: 'hidden',
        }}
      >
        {frame ? (
          <>
            {transition ? (
              <SceneVisual
                visual={transition.previous}
                assets={props.assets}
                logicalWidth={props.logicalWidth}
                logicalHeight={props.logicalHeight}
                opacity={1 - transition.opacity}
              />
            ) : null}
            <SceneVisual
              visual={frame}
              assets={props.assets}
              logicalWidth={props.logicalWidth}
              logicalHeight={props.logicalHeight}
              opacity={transition ? transition.opacity : 1}
              subtitleTestId="export-subtitle"
            />
          </>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/** 占位默认值，真实尺寸/时长由 calculateMetadata 按 inputProps 覆盖。 */
const DEFAULT_PROPS: CompositionProps = {
  width: LOGICAL_WIDTH,
  height: LOGICAL_HEIGHT,
  fps: 30,
  durationInFrames: 1,
  logicalWidth: LOGICAL_WIDTH,
  logicalHeight: LOGICAL_HEIGHT,
  assets: {},
  frameChunks: [],
};

const RemotionRoot: FC = () => (
  <Composition
    id={COMPOSITION_ID}
    component={SceneFrame}
    defaultProps={DEFAULT_PROPS}
    durationInFrames={1}
    fps={30}
    width={LOGICAL_WIDTH}
    height={LOGICAL_HEIGHT}
    calculateMetadata={({ props }) => ({
      durationInFrames: props.durationInFrames,
      fps: props.fps,
      width: props.width,
      height: props.height,
    })}
  />
);

registerRoot(RemotionRoot);
