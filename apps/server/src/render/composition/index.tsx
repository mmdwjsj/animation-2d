import type { CSSProperties, FC } from 'react';
import { AbsoluteFill, Composition, Img, registerRoot, useCurrentFrame } from 'remotion';
import {
  COMPOSITION_ID,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  type CompositionProps,
  type RenderLayer,
} from './props';

/**
 * Remotion Adapter（架构 8 节）：把服务端预计算的 `AnimationFrameState` 绘制指令
 * 转成视频帧画面。人物位置、姿态、嘴型、字幕全部来自共享动画核心，
 * 这里不重复实现任何动画计算。
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

const SceneFrame: FC<CompositionProps> = (props) => {
  const current = useCurrentFrame();
  const lastIndex = Math.max(0, props.frames.length - 1);
  const frame = props.frames[Math.min(Math.max(current, 0), lastIndex)];
  const scale = props.width / props.logicalWidth;
  const background = props.background ? props.assets[props.background] : undefined;

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
        {background ? (
          <Img
            src={background}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: props.logicalWidth,
              height: props.logicalHeight,
            }}
          />
        ) : null}

        {frame?.layers.map((layer, index) => (
          <Img key={index} src={props.assets[layer.src]} style={layerStyle(layer)} />
        ))}

        {frame?.subtitle ? (
          <div
            data-testid="export-subtitle"
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
                fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
                fontSize: 36,
                lineHeight: 1.5,
                textAlign: 'center',
              }}
            >
              {frame.subtitle.characterName ? (
                <span style={{ marginRight: 8, fontSize: 28, color: '#9AA3B2' }}>
                  {frame.subtitle.characterName}：
                </span>
              ) : null}
              {frame.subtitle.text}
            </div>
          </div>
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
  background: null,
  frames: [],
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
