import {
  PARSE_ERROR_TYPE_LABELS,
  POSTURE_LABELS,
  type DraftImpact,
  type DraftMatch,
  type DraftScene,
  type ScriptDraft,
} from '@animation/shared';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Button from '../components/Button';
import Modal from '../components/Modal';
import { getErrorMessage, projectsApi, scriptsApi } from '../lib/api';

/**
 * 剧本编辑与解析页（PRD 8 / 架构 5.3、5.4、11 节）。
 * 左 55% 原始剧本 + 行号，右 45% 解析结果预览，底部错误与警告可展开并定位到行。
 * 关键约束：修改剧本或解析草稿都不会覆盖已确认的动画数据，只有「创建动画草稿」
 * 且用户在影响对比弹窗中确认后才整体替换。
 */

const LINE_HEIGHT = 22;

const EMPTY_DRAFT: ScriptDraft = { scenes: [], errors: [], warnings: [] };
const EMPTY_MATCH: DraftMatch = { scenes: [], characters: [], unmatched: [] };

/** PRD 15 标准验收剧本，仅作为「载入示例」的便捷入口，不冒充持久化数据。 */
const SAMPLE_SCRIPT = [
  '# 场景：客厅',
  '',
  '# 角色：老王、小李',
  '',
  '老王（坐着）：你回来了？',
  '小李（站着）：我的蛋糕呢？',
  '老王：我不知道啊。',
  '小李：那你嘴角的奶油是什么？',
  '老王（站着）：这是牙膏！',
].join('\n');

interface Notice {
  kind: 'ok' | 'error';
  text: string;
}

export default function ScriptPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [projectName, setProjectName] = useState('');
  const [original, setOriginal] = useState('');
  const [draft, setDraft] = useState<ScriptDraft>(EMPTY_DRAFT);
  const [match, setMatch] = useState<DraftMatch>(EMPTY_MATCH);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [impact, setImpact] = useState<DraftImpact | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [highlightLine, setHighlightLine] = useState<number | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [project, file] = await Promise.all([
          projectsApi.get(projectId),
          scriptsApi.get(projectId),
        ]);
        if (cancelled) return;
        setProjectName(project.name);
        setOriginal(file.original);
        setDraft(file.draft);
        setErrorsOpen(file.draft.errors.length > 0);
        // 素材匹配结果由确定性解析重新计算，与右侧草稿预览保持同一套规则。
        if (file.original.trim().length > 0) {
          const parsed = await scriptsApi.parse(file.original);
          if (!cancelled) setMatch(parsed.match);
        }
        if (!cancelled) setLoading(false);
      } catch (error) {
        if (!cancelled) {
          setLoadError(getErrorMessage(error));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const lines = useMemo(() => original.split('\n'), [original]);
  const errorLines = useMemo(
    () => new Set(draft.errors.map((error) => error.line)),
    [draft],
  );
  const dialogueCount = useMemo(
    () => draft.scenes.reduce((total, scene) => total + scene.dialogues.length, 0),
    [draft],
  );
  const canCreateDraft = draft.errors.length === 0 && draft.scenes.length > 0 && !busy;

  const syncScroll = (): void => {
    const textarea = textareaRef.current;
    const gutter = gutterRef.current;
    if (textarea && gutter) gutter.scrollTop = textarea.scrollTop;
  };

  /** 点击错误或对白项时，选中原始剧本对应行并滚动到可视区域。 */
  const focusLine = (line: number): void => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const parts = original.split('\n');
    const index = Math.max(0, Math.min(line - 1, parts.length - 1));
    const start = parts.slice(0, index).reduce((sum, part) => sum + part.length + 1, 0);
    textarea.focus();
    textarea.setSelectionRange(start, start + parts[index].length);
    const top = Math.max(0, index * LINE_HEIGHT - textarea.clientHeight / 3);
    textarea.scrollTop = top;
    if (gutterRef.current) gutterRef.current.scrollTop = top;
    setHighlightLine(line);
  };

  const handleParse = async (): Promise<void> => {
    if (!projectId || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await scriptsApi.parse(original);
      setDraft(result.draft);
      setMatch(result.match);
      setErrorsOpen(result.draft.errors.length > 0);
      // 解析时同时保存原始剧本与新草稿；动画数据保持不动。
      await scriptsApi.save(projectId, { original, draft: result.draft });
      setDirty(false);
      setNotice({
        kind: result.draft.errors.length > 0 ? 'error' : 'ok',
        text:
          result.draft.errors.length > 0
            ? `解析完成，发现 ${result.draft.errors.length} 处错误，草稿已保存，动画数据未改动。`
            : '解析完成，草稿已保存，动画数据未改动。',
      });
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!projectId || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await scriptsApi.save(projectId, { original, draft });
      setDirty(false);
      setNotice({ kind: 'ok', text: '剧本与解析草稿已保存，动画数据未改动。' });
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateDraft = async (): Promise<void> => {
    if (!projectId || !canCreateDraft) return;
    setBusy(true);
    setNotice(null);
    try {
      setImpact(await scriptsApi.preview(projectId, draft));
    } catch (error) {
      setNotice({ kind: 'error', text: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmImport = async (): Promise<void> => {
    if (!projectId || busy) return;
    setBusy(true);
    try {
      await scriptsApi.importDraft(projectId, draft);
      navigate(`/projects/${projectId}`);
    } catch (error) {
      setImpact(null);
      setNotice({ kind: 'error', text: getErrorMessage(error) });
      setBusy(false);
    }
  };

  if (!projectId) {
    return <CenteredNotice title="缺少项目 ID" message="请从项目首页打开一个项目。" />;
  }
  if (loading) {
    return <CenteredNotice title="正在读取剧本…" message="正在加载原始剧本与解析草稿。" />;
  }
  if (loadError) {
    return (
      <CenteredNotice
        title="无法读取剧本"
        message={loadError}
        action={
          <Link to="/">
            <Button variant="primary">返回项目首页</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="script-page">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel px-4">
        <Link to="/" className="text-sm text-muted hover:text-ink">
          ← 返回
        </Link>
        <span className="h-5 w-px bg-line" />
        <span className="text-sm font-semibold text-ink">剧本编辑</span>
        <span className="max-w-[200px] truncate text-xs text-muted">{projectName}</span>
        <span className="text-xs text-muted">
          {busy ? '处理中…' : dirty ? '未保存' : '已保存'}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <Button onClick={handleSave} disabled={busy}>
            保存剧本
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void handleParse()}>
            解析剧本
          </Button>
          <Button onClick={() => setClearOpen(true)} disabled={busy}>
            清空剧本
          </Button>
          <span className="h-5 w-px bg-line" />
          <Button
            variant="primary"
            disabled={!canCreateDraft}
            title={
              draft.errors.length > 0
                ? '请先修正解析错误'
                : draft.scenes.length === 0
                  ? '请先解析出至少一个场景'
                  : '生成动画草稿并进入工作台'
            }
            onClick={() => void handleCreateDraft()}
          >
            创建动画草稿
          </Button>
          <Link to={`/projects/${projectId}`}>
            <Button>进入工作台</Button>
          </Link>
        </div>
      </header>

      {notice && (
        <div
          className={`shrink-0 border-b px-4 py-2 text-xs ${
            notice.kind === 'error'
              ? 'border-danger bg-panel text-danger'
              : 'border-success bg-panel text-success'
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* 左：原始剧本编辑区（PRD 8.2） */}
        <section className="flex w-[55%] min-w-0 shrink-0 flex-col border-r border-line">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-line bg-panel px-4">
            <span className="section-title">原始剧本</span>
            <span className="text-xs text-muted"># 场景： / # 角色： / 角色名（姿态）：台词</span>
          </div>
          <div className="relative flex min-h-0 flex-1 bg-page">
            <div
              ref={gutterRef}
              className="h-full w-12 shrink-0 overflow-hidden border-r border-line bg-panel py-2"
            >
              {lines.map((_, index) => {
                const lineNumber = index + 1;
                const hasError = errorLines.has(lineNumber);
                const highlighted = highlightLine === lineNumber;
                return (
                  <div
                    key={lineNumber}
                    style={{ height: LINE_HEIGHT }}
                    className={`flex items-center justify-end pr-2 font-mono text-[11px] ${
                      hasError ? 'text-danger' : highlighted ? 'text-accent' : 'text-muted'
                    }`}
                  >
                    {hasError ? '●' : lineNumber}
                  </div>
                );
              })}
            </div>
            <textarea
              ref={textareaRef}
              id="script-original"
              aria-label="原始剧本编辑区"
              spellCheck={false}
              className="h-full min-w-0 flex-1 resize-none bg-transparent px-3 py-2 font-mono text-[13px] text-ink outline-none"
              style={{ lineHeight: `${LINE_HEIGHT}px` }}
              value={original}
              onScroll={syncScroll}
              onChange={(event) => {
                setOriginal(event.target.value);
                setDirty(true);
                setHighlightLine(null);
              }}
            />
            {original.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-20">
                <div className="pointer-events-auto rounded-lg border border-dashed border-line bg-panel px-6 py-5 text-center">
                  <p className="text-sm text-ink">还没有剧本，按固定格式写几句对白开始。</p>
                  <p className="mt-1 text-xs text-muted">
                    第一版只识别场景、角色和对白，不会猜测动作或分镜。
                  </p>
                  <Button
                    variant="primary"
                    className="mt-3"
                    onClick={() => {
                      setOriginal(SAMPLE_SCRIPT);
                      setDirty(true);
                    }}
                  >
                    载入示例剧本
                  </Button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 右：解析结果预览（PRD 8.3） */}
        <section className="flex w-[45%] min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center border-b border-line bg-panel px-4">
            <span className="section-title">解析结果预览</span>
            <span className="ml-auto text-xs text-muted">
              {draft.scenes.length} 场景 · {dialogueCount} 对白
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="parse-result">
            {draft.scenes.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <p className="text-sm text-ink">还没有解析结果</p>
                <p className="mt-1 text-xs text-muted">填写剧本后点击「解析剧本」查看场景、角色与对白。</p>
              </div>
            ) : (
              draft.scenes.map((scene) => (
                <SceneCard key={scene.id} scene={scene} match={match} onFocusLine={focusLine} />
              ))
            )}

            {match.unmatched.length > 0 && (
              <div className="mt-3 rounded border border-warning bg-panel p-3">
                <p className="text-xs font-semibold text-warning">待处理事项（未匹配素材，不会伪装成已绑定）</p>
                <ul className="mt-1.5 space-y-1 text-xs text-muted">
                  {match.unmatched.map((item) => (
                    <li key={item}>· {item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* 底部错误与警告（PRD 8.4），默认收起，有错误时自动展开 */}
      <footer className="shrink-0 border-t border-line bg-panel">
        <button
          type="button"
          onClick={() => setErrorsOpen(!errorsOpen)}
          className="flex h-10 w-full items-center gap-3 px-4 text-left text-xs text-ink hover:bg-subtle"
        >
          <span className="section-title">错误和警告</span>
          <span className="text-danger">{draft.errors.length} 错误</span>
          <span className="text-warning">{draft.warnings.length} 警告</span>
          <span className="ml-auto text-muted">{errorsOpen ? '收起 ▲' : '展开 ▼'}</span>
        </button>
        {errorsOpen && (
          <div className="max-h-40 overflow-auto border-t border-line px-4 py-2">
            {draft.errors.length === 0 && draft.warnings.length === 0 && (
              <p className="text-xs text-muted">暂无错误和警告。</p>
            )}
            {draft.errors.map((error, index) => (
              <button
                key={`error-${index}`}
                type="button"
                data-testid="parse-error"
                onClick={() => focusLine(error.line)}
                className="block w-full rounded px-2 py-1 text-left text-xs text-danger hover:bg-subtle"
              >
                第 {error.line} 行 · {PARSE_ERROR_TYPE_LABELS[error.type]} · {error.message}
              </button>
            ))}
            {draft.warnings.map((warning, index) => (
              <p key={`warning-${index}`} className="px-2 py-1 text-xs text-warning">
                {warning}
              </p>
            ))}
          </div>
        )}
      </footer>

      <Modal
        open={impact !== null}
        title="创建动画草稿"
        onClose={() => setImpact(null)}
        footer={
          <>
            <Button onClick={() => setImpact(null)} disabled={busy}>
              取消
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void handleConfirmImport()}>
              确认创建
            </Button>
          </>
        }
      >
        {impact && (
          <div>
            <p className="text-sm leading-6 text-ink">
              按当前解析结果创建动画草稿，并建立场景、人物实例与对白事件。
            </p>
            <div className="mt-3 rounded border border-line bg-page p-3 text-xs leading-6">
              <p className="text-muted">
                当前动画数据：{impact.current.scenes} 场景 · {impact.current.characters} 人物 ·{' '}
                {impact.current.dialogues} 对白
              </p>
              <p className="text-ink">
                新草稿：{impact.next.scenes} 场景 · {impact.next.characters} 人物 ·{' '}
                {impact.next.dialogues} 对白
              </p>
            </div>
            {impact.warning && (
              <p className="mt-3 rounded border border-warning bg-panel px-3 py-2 text-xs leading-5 text-warning">
                {impact.warning}
              </p>
            )}
            {impact.unmatched.length > 0 && (
              <div className="mt-3 text-xs leading-6 text-warning">
                <p>待处理事项（未匹配素材的角色不会生成人物实例）：</p>
                {impact.unmatched.map((item) => (
                  <p key={item}>· {item}</p>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs leading-5 text-muted">
              原始剧本与解析草稿已单独保存；确认前不会修改当前动画数据。
            </p>
          </div>
        )}
      </Modal>

      <Modal
        open={clearOpen}
        title="清空剧本"
        onClose={() => setClearOpen(false)}
        footer={
          <>
            <Button onClick={() => setClearOpen(false)}>取消</Button>
            <Button
              variant="danger"
              onClick={() => {
                setOriginal('');
                setDraft(EMPTY_DRAFT);
                setMatch(EMPTY_MATCH);
                setErrorsOpen(false);
                setDirty(true);
                setClearOpen(false);
                setNotice({ kind: 'ok', text: '已清空编辑区，点击「保存剧本」后才会写入磁盘。' });
              }}
            >
              确认清空
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6 text-ink">
          将清空左侧原始剧本文本与当前解析结果。已创建的动画数据不会被修改。
        </p>
        <p className="mt-2 text-xs leading-5 text-muted">
          清空后需点击「保存剧本」才会真正写入项目文件，此操作不可撤销。
        </p>
      </Modal>
    </div>
  );
}

interface SceneCardProps {
  scene: DraftScene;
  match: DraftMatch;
  onFocusLine: (line: number) => void;
}

function SceneCard({ scene, match, onFocusLine }: SceneCardProps) {
  const sceneMatch = match.scenes.find((item) => item.id === scene.id);
  const nameOf = (characterId: string): string =>
    scene.characters.find((character) => character.id === characterId)?.name ?? characterId;

  return (
    <div className="mb-3 rounded border border-line bg-panel p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-ink">{scene.name}</span>
        <span className={`text-xs ${sceneMatch?.matched ? 'text-success' : 'text-warning'}`}>
          {sceneMatch?.matched
            ? `背景素材：${sceneMatch.assetName}`
            : '背景素材：未匹配（待处理）'}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {scene.characters.map((character) => {
          const characterMatch = match.characters.find((item) => item.id === character.id);
          return (
            <span
              key={character.id}
              className="rounded border border-line bg-page px-2 py-1 text-xs text-ink"
            >
              {character.name} · {POSTURE_LABELS[character.initialPosture]}
              <span className={characterMatch?.matched ? 'text-success' : 'text-warning'}>
                {characterMatch?.matched ? ' · 素材已绑定' : ' · 素材未匹配'}
              </span>
            </span>
          );
        })}
      </div>

      <div className="mt-3 space-y-0.5">
        {scene.dialogues.map((dialogue) => (
          <button
            key={dialogue.id}
            type="button"
            data-testid="dialogue-item"
            aria-label={`定位第 ${dialogue.sourceLine} 行对白`}
            onClick={() => onFocusLine(dialogue.sourceLine)}
            className="flex w-full items-start gap-2 rounded px-2 py-1 text-left text-xs hover:bg-subtle"
          >
            <span className="w-5 shrink-0 text-muted">{dialogue.sequence}</span>
            <span className="w-14 shrink-0 truncate text-accent">{nameOf(dialogue.characterId)}</span>
            <span className="min-w-0 flex-1 truncate text-ink">{dialogue.text}</span>
            <span className="shrink-0 text-muted">{POSTURE_LABELS[dialogue.posture]}</span>
            <span className="shrink-0 text-muted">L{dialogue.sourceLine}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface CenteredNoticeProps {
  title: string;
  message: string;
  action?: ReactNode;
}

function CenteredNotice({ title, message, action }: CenteredNoticeProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <p className="text-base font-medium text-ink">{title}</p>
      <p className="text-sm text-muted">{message}</p>
      {action}
    </div>
  );
}
