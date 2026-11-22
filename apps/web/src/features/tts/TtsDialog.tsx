import {
  PROJECT_LANGUAGES,
  PROJECT_LANGUAGE_LABELS,
  type ProjectLanguage,
  type TtsGeneratedItem,
  type TtsGenerateResult,
  type TtsPlan,
  type TtsProvider,
} from '@animation/shared';
import { useEffect, useMemo, useState } from 'react';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { audioFileUrl, getErrorMessage, ttsApi } from '../../lib/api';

/**
 * 生成配音弹窗（PRD 7.2 / 12.3 / 13，双语扩展）。
 *
 * 流程严格遵循「先预览影响 → 用户确认 → 才写动画数据」：
 * 打开时只调用只读的 plan，confirmed 由前端在点击生成时唯一附加。
 * UI 只展示通用参数（语言 / 引擎 / 声音 / 语速），厂商差异封装在服务端 Provider。
 *
 * 默认「按语言自动路由」：不指定引擎，服务端按每句对白语言选择支持该语言的
 * 引擎与该语言默认音色；用户也可显式指定引擎与音色，并可限定只生成某一种语言。
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
  /** 空字符串 = 按语言自动路由；非空 = 用户显式指定引擎。 */
  const [providerId, setProviderId] = useState('');
  const [voiceId, setVoiceId] = useState('');
  /** 空字符串 = 全部语言；否则只生成指定语言的对白。 */
  const [language, setLanguage] = useState<ProjectLanguage | ''>('');
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

  const explicitProvider = useMemo(
    () => providers.find((item) => item.id === providerId) ?? null,
    [providers, providerId],
  );
  const speedProvider = explicitProvider ?? providers[0] ?? null;

  // 显式选择引擎后，把音色初始化为该引擎的默认值。
  useEffect(() => {
    if (!explicitProvider) return;
    if (!voiceId || !explicitProvider.voices.some((voice) => voice.id === voiceId)) {
      setVoiceId(explicitProvider.defaultVoiceId);
    }
  }, [explicitProvider, voiceId]);

  useEffect(() => {
    if (speedProvider && speed === 1 && speedProvider.defaultSpeed !== 1) {
      setSpeed(speedProvider.defaultSpeed);
    }
  }, [speedProvider, speed]);

  /** 请求参数：自动路由时省略 providerId / voiceId，交由服务端按语言决定。 */
  const params = useMemo(
    () => ({
      ...(providerId ? { providerId } : {}),
      ...(language ? { language: language as ProjectLanguage } : {}),
      ...(providerId && voiceId ? { voiceId } : {}),
      speed,
    }),
    [providerId, language, voiceId, speed],
  );

  // 参数或打开状态变化时重新做只读影响预览，绝不在此写盘。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPlanning(true);
    setPlanError(null);
    void ttsApi
      .plan(projectId, params)
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
  }, [open, projectId, params]);

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
    setError(null);
    if (dialogueIds) setRegeneratingId(dialogueIds[0]);
    else setGenerating(true);
    try {
      const result = await ttsApi.generate({
        projectId,
        ...params,
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

  const activeVoices = explicitProvider?.voices ?? [];
  const minSpeed = speedProvider?.minSpeed ?? 0.5;
  const maxSpeed = speedProvider?.maxSpeed ?? 2;
  const autoRoute = !explicitProvider;

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
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted">配音语言</span>
              <select
                aria-label="配音语言"
                data-testid="tts-language"
                className="field-input w-full"
                value={language}
                onChange={(event) => setLanguage(event.target.value as ProjectLanguage | '')}
              >
                <option value="">全部语言（按对白语言分别路由）</option>
                {PROJECT_LANGUAGES.map((item) => (
                  <option key={item} value={item}>
                    仅{PROJECT_LANGUAGE_LABELS[item]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted">TTS 引擎</span>
              <select
                aria-label="TTS 引擎"
                className="field-input w-full"
                value={providerId}
                onChange={(event) => {
                  setProviderId(event.target.value);
                  setVoiceId('');
                }}
              >
                <option value="">自动（按语言路由）</option>
                {providers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}（{item.languages.map((lang) => PROJECT_LANGUAGE_LABELS[lang]).join('/')}）
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-muted">声音</span>
              <select
                aria-label="配音声音"
                className="field-input w-full"
                value={autoRoute ? '' : voiceId}
                disabled={autoRoute}
                onChange={(event) => setVoiceId(event.target.value)}
              >
                {autoRoute ? (
                  <option value="">按语言自动选择各引擎默认音色</option>
                ) : (
                  PROJECT_LANGUAGES.map((lang) => {
                    const voices = activeVoices.filter((voice) => voice.language === lang);
                    if (voices.length === 0) return null;
                    return (
                      <optgroup key={lang} label={PROJECT_LANGUAGE_LABELS[lang]}>
                        {voices.map((voice) => (
                          <option key={voice.id} value={voice.id}>
                            {voice.name}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })
                )}
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
          <p className="mt-2 text-[11px] leading-5 text-muted">
            {explicitProvider
              ? explicitProvider.description
              : '自动路由：每条对白按自身语言选择支持该语言的引擎与默认音色；中泰混排项目一次生成即可各走各的引擎。角色可在右侧属性面板按语言覆盖音色。'}
          </p>
        </section>

        {/* 按语言路由明细 */}
        {plan && plan.routing.length > 0 && (
          <section
            data-testid="tts-routing"
            className="rounded border border-line bg-page px-4 py-3"
          >
            <h3 className="mb-2 text-xs font-semibold text-ink">
              按语言路由（{plan.routing.length} 条）
            </h3>
            <div className="space-y-1">
              {plan.routing.map((item) => (
                <div
                  key={`${item.language}-${item.providerId}-${item.voiceId}`}
                  data-testid="tts-routing-entry"
                  data-language={item.language}
                  className="flex items-center gap-2 rounded bg-subtle px-2 py-1.5 text-[11px]"
                >
                  <span className="shrink-0 rounded bg-elevated px-1.5 py-0.5 text-accent">
                    {PROJECT_LANGUAGE_LABELS[item.language]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {item.providerName} / {item.voiceName}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted">{item.count} 句</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 只读影响预览 */}
        <section data-testid="tts-plan" className="rounded border border-line bg-page px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-ink">时间轴更新影响</h3>
            <span className="text-[11px] text-muted">
              {planning
                ? '正在计算…'
                : plan
                  ? `本次 ${plan.targetCount} 句 · ${plan.sceneCount} 个场景`
                  : '—'}
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
              <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                <span data-testid="tts-protected-count">
                  手动调整受保护：{plan.protectedCount} 句
                </span>
                <span data-testid="tts-replacing-count">
                  已有音频将被替换：{plan.replacingCount} 句
                </span>
                <span>当前场景时长：{plan.currentSceneDurationFrames} 帧</span>
                <span data-testid="tts-project-duration">
                  全部场景总时长：{plan.projectDurationFrames} 帧
                </span>
              </div>
              <div className="max-h-[150px] space-y-1 overflow-y-auto pr-1">
                {plan.dialogues.map((dialogue) => (
                  <div
                    key={dialogue.dialogueId}
                    data-testid="tts-plan-dialogue"
                    data-language={dialogue.language ?? ''}
                    className="flex items-center gap-2 rounded bg-subtle px-2 py-1.5 text-[11px]"
                  >
                    {dialogue.sceneName ? (
                      <span
                        className="shrink-0 rounded bg-elevated px-1.5 py-0.5 text-[10px] text-muted"
                        title="所属场景"
                      >
                        {dialogue.sceneName}
                      </span>
                    ) : null}
                    {dialogue.language && (
                      <span className="shrink-0 rounded bg-elevated px-1.5 py-0.5 text-[10px] text-accent">
                        {PROJECT_LANGUAGE_LABELS[dialogue.language]}
                      </span>
                    )}
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
                  data-language={item.language ?? ''}
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
