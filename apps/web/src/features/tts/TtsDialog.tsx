import type {
  TtsGeneratedItem,
  TtsGenerateResult,
  TtsPlan,
  TtsProvider,
} from '@animation/shared';
import { useEffect, useMemo, useState } from 'react';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { audioFileUrl, getErrorMessage, ttsApi } from '../../lib/api';

/**
 * 生成配音弹窗（PRD 7.2 / 12.3 / 13）。
 *
 * 流程严格遵循「先预览影响 → 用户确认 → 才写动画数据」：
 * 打开时只调用只读的 plan，confirmed 由前端在点击生成时唯一附加。
 * UI 只展示通用参数（引擎 / 声音 / 语速），厂商差异封装在服务端 Provider。
 */
interface TtsDialogProps {
  open: boolean;
  projectId: string;
  providers: TtsProvider[];
  onClose: () => void;
  /** 生成成功后把服务端已保存的动画数据与音频索引交给工作台。 */
  onGenerated: (result: TtsGenerateResult) => void;
}

export default function TtsDialog({
  open,
  projectId,
  providers,
  onClose,
  onGenerated,
}: TtsDialogProps) {
  const [providerId, setProviderId] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [speed, setSpeed] = useState(1);
  const [plan, setPlan] = useState<TtsPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<TtsGeneratedItem[]>([]);
  const [skipped, setSkipped] = useState<Array<{ dialogueId: string; reason: string }>>([]);
  const [generated, setGenerated] = useState(false);

  const provider = useMemo(
    () => providers.find((item) => item.id === providerId) ?? providers[0] ?? null,
    [providers, providerId],
  );

  // 首次拿到 Provider 列表时初始化通用参数。
  useEffect(() => {
    if (!provider) return;
    if (!providerId) setProviderId(provider.id);
    if (!voiceId || !provider.voices.some((voice) => voice.id === voiceId)) {
      setVoiceId(provider.defaultVoiceId);
    }
    if (speed === 1 && provider.defaultSpeed !== 1) setSpeed(provider.defaultSpeed);
  }, [provider, providerId, voiceId, speed]);

  // 参数或打开状态变化时重新做只读影响预览，绝不在此写盘。
  useEffect(() => {
    if (!open || !provider || !voiceId) return;
    let cancelled = false;
    setPlanning(true);
    setPlanError(null);
    void ttsApi
      .plan(projectId, { providerId: provider.id, voiceId, speed })
      .then((next) => {
        if (!cancelled) setPlan(next);
      })
      .catch((cause) => {
        if (!cancelled) setPlanError(getErrorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setPlanning(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, provider, voiceId, speed]);

  const applyResult = (result: TtsGenerateResult) => {
    onGenerated(result);
    setItems((current) => {
      const map = new Map(current.map((item) => [item.dialogueId, item]));
      for (const item of result.generated) map.set(item.dialogueId, item);
      return [...map.values()];
    });
    setSkipped(result.skipped);
    setGenerated(true);
    setError(null);
  };

  const generate = async (dialogueIds?: string[]) => {
    if (!provider) return;
    setError(null);
    if (dialogueIds) setRegeneratingId(dialogueIds[0]);
    else setGenerating(true);
    try {
      const result = await ttsApi.generate({
        projectId,
        providerId: provider.id,
        voiceId,
        speed,
        ...(dialogueIds ? { dialogueIds } : {}),
      });
      applyResult(result);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setGenerating(false);
      setRegeneratingId(null);
    }
  };

  const activeVoices = provider?.voices ?? [];
  const minSpeed = provider?.minSpeed ?? 0.5;
  const maxSpeed = provider?.maxSpeed ?? 2;

  return (
    <Modal
      open={open}
      title="生成配音"
      widthClass="w-[720px]"
      onClose={onClose}
      footer={
        <>
          {error && <span className="mr-auto max-w-[360px] text-xs text-danger">{error}</span>}
          <Button onClick={onClose}>{generated ? '完成' : '取消'}</Button>
          <Button
            variant="primary"
            loading={generating}
            disabled={!plan || planning || plan.targetCount === 0}
            onClick={() => void generate()}
          >
            {generated ? '重新生成全部配音' : '确认生成配音'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* 通用参数：不含任何厂商专有字段 */}
        <section className="rounded border border-line bg-page px-4 py-3">
          <h3 className="mb-3 text-xs font-semibold text-ink">配音设置</h3>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted">TTS 引擎</span>
              <select
                aria-label="TTS 引擎"
                className="field-input w-full"
                value={provider?.id ?? ''}
                onChange={(event) => {
                  setProviderId(event.target.value);
                  setVoiceId('');
                }}
              >
                {providers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted">声音</span>
              <select
                aria-label="配音声音"
                className="field-input w-full"
                value={voiceId}
                onChange={(event) => setVoiceId(event.target.value)}
              >
                {activeVoices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted">
                语速 <span className="text-ink">{speed.toFixed(1)}×</span>
              </span>
              <input
                aria-label="配音语速"
                type="range"
                min={minSpeed}
                max={maxSpeed}
                step={0.1}
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
                className="mt-2 w-full accent-accent"
              />
            </label>
          </div>
          {provider && (
            <p className="mt-2 text-[11px] leading-5 text-muted">{provider.description}</p>
          )}
        </section>

        {/* 只读影响预览 */}
        <section data-testid="tts-plan" className="rounded border border-line bg-page px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-ink">时间轴更新影响</h3>
            <span className="text-[11px] text-muted">
              {planning ? '正在计算…' : plan ? `本次 ${plan.targetCount} 句` : '—'}
            </span>
          </div>
          {planError && <p className="text-xs text-danger">{planError}</p>}
          {plan && (
            <>
              <div
                data-testid="tts-warning"
                className="mb-3 rounded border px-3 py-2 text-[11px] leading-5 text-ink"
                style={{ borderColor: 'rgba(224,168,64,0.5)', background: 'rgba(224,168,64,0.08)' }}
              >
                {plan.warning}
              </div>
              <div className="mb-2 flex gap-3 text-[11px] text-muted">
                <span data-testid="tts-protected-count">
                  手动调整受保护：{plan.protectedCount} 句
                </span>
                <span data-testid="tts-replacing-count">
                  已有音频将被替换：{plan.replacingCount} 句
                </span>
                <span>当前场景时长：{plan.currentSceneDurationFrames} 帧</span>
              </div>
              <div className="max-h-[150px] space-y-1 overflow-y-auto pr-1">
                {plan.dialogues.map((dialogue) => (
                  <div
                    key={dialogue.dialogueId}
                    data-testid="tts-plan-dialogue"
                    className="flex items-center gap-2 rounded bg-subtle px-2 py-1.5 text-[11px]"
                  >
                    <span className="w-14 shrink-0 text-ink">{dialogue.characterName}</span>
                    <span className="min-w-0 flex-1 truncate text-muted">{dialogue.text}</span>
                    <span
                      className="shrink-0 tabular-nums text-muted"
                      title={`当前起始帧 ${dialogue.currentStartFrame}，时长 ${dialogue.currentDurationFrames} 帧`}
                    >
                      起 {dialogue.currentStartFrame} · 长 {dialogue.currentDurationFrames}
                    </span>
                    {dialogue.manuallyTimed && (
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 text-warning"
                        style={{ background: 'rgba(224,168,64,0.16)' }}
                      >
                        手动保护
                      </span>
                    )}
                    {dialogue.hasAudio && (
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 text-accent"
                        style={{ background: 'rgba(91,141,239,0.18)' }}
                      >
                        已有音频
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* 生成结果、真实时长、试听、单句重生成 */}
        {generated && (
          <section className="rounded border border-line bg-page px-4 py-3">
            <h3 className="mb-2 text-xs font-semibold text-ink">
              生成结果（{items.length} 句）
            </h3>
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.dialogueId}
                  data-testid="tts-generated-item"
                  data-dialogue-id={item.dialogueId}
                  data-duration-ms={item.durationMs}
                  className="rounded bg-subtle px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-ink">
                      {plan?.dialogues.find((d) => d.dialogueId === item.dialogueId)?.text ?? '对白'}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted">
                      {Math.round(item.durationMs)} ms → {item.durationFrames} 帧
                    </span>
                    <Button
                      className="h-7 px-2 text-[11px]"
                      loading={regeneratingId === item.dialogueId}
                      onClick={() => void generate([item.dialogueId])}
                    >
                      重新生成
                    </Button>
                  </div>
                  <audio
                    data-testid="tts-audio-preview"
                    controls
                    preload="metadata"
                    src={audioFileUrl(projectId, item.assetId)}
                    className="mt-2 h-8 w-full"
                  />
                </div>
              ))}
            </div>
            {skipped.length > 0 && (
              <p className="mt-2 text-[11px] text-warning">
                跳过 {skipped.length} 句：{skipped[0].reason}
              </p>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
