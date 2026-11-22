import { AUTOSAVE_DELAY_MS, type StageObject, type TtsGenerateResult } from '@animation/shared';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import Button from '../components/Button';
import Modal from '../components/Modal';
import StatusBadge from '../components/StatusBadge';
import CharacterEditorModal from '../features/stage-editor/CharacterEditorModal';
import { characterDisplayHeight } from '../features/stage-editor/layerGeometry';
import PixiStage from '../features/stage-editor/PixiStage';
import PropertyPanel from '../features/stage-editor/PropertyPanel';
import ResourcePanel, { type ResourceTab } from '../features/stage-editor/ResourcePanel';
import SceneEditorModal, {
  type SceneEditFocus,
  type SceneEditorPatch,
} from '../features/workbench/SceneEditorModal';
import SceneTabBar from '../features/workbench/SceneTabBar';
import TimelinePanel from '../features/timeline/TimelinePanel';
import TtsDialog from '../features/tts/TtsDialog';
import ExportDialog from '../features/render/ExportDialog';
import { buildAudioEnvelopes, buildReadyAudio, useAudioStore } from '../stores/audioStore';
import { useEditorStore, type SaveStatus } from '../stores/editorStore';
import { selectActiveScene, useStageStore } from '../stores/stageStore';
import { useTimelineStore } from '../stores/timelineStore';

/**
 * 动画工作台（PRD 7.1）。
 * 阶段 2：PixiJS 画布、坐标系统与静态道具；
 * 阶段 3：分层人物素材、姿态锚点校准、嘴型预览与 4 角色上限；
 * 阶段 5：剧本草稿导入；
 * 阶段 6：底部时间轴、确定性帧预览、撤销 / 重做；
 * 阶段 7：TTS 配音、真实时长回写、缓存振幅包络驱动嘴型；
 * 阶段 8：导出前检查、Remotion 逐帧渲染与 FFmpeg 音视频合成。
 * 场景栏：切换、新建、复制、重命名、删除、调整顺序、进入转场与场景编辑（PRD 7.3）。
 */
export default function WorkbenchPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const project = useEditorStore((state) => state.project);
  const draftName = useEditorStore((state) => state.draftName);
  const editorSaveStatus = useEditorStore((state) => state.saveStatus);
  const saveError = useEditorStore((state) => state.saveError);
  const loadError = useEditorStore((state) => state.loadError);
  const loadProject = useEditorStore((state) => state.loadProject);
  const setDraftName = useEditorStore((state) => state.setDraftName);
  const saveProjectNow = useEditorStore((state) => state.saveNow);

  const stage = useStageStore((state) => state.stage);
  const assets = useStageStore((state) => state.assets);
  const characters = useStageStore((state) => state.characters);
  const stageLoading = useStageStore((state) => state.loading);
  const stageLoadError = useStageStore((state) => state.loadError);
  const loadStage = useStageStore((state) => state.load);
  const scene = useStageStore(selectActiveScene);
  const selectedId = useStageStore((state) => state.selectedId);
  const viewport = useStageStore((state) => state.viewport);
  const showSafeArea = useStageStore((state) => state.showSafeArea);
  const stageSaveStatus = useStageStore((state) => state.saveStatus);
  const stageSaveError = useStageStore((state) => state.saveError);
  const limitNotice = useStageStore((state) => state.limitNotice);
  const select = useStageStore((state) => state.select);
  const setActiveScene = useStageStore((state) => state.setActiveScene);
  const addScene = useStageStore((state) => state.addScene);
  const duplicateScene = useStageStore((state) => state.duplicateScene);
  const updateScene = useStageStore((state) => state.updateScene);
  const deleteScene = useStageStore((state) => state.deleteScene);
  const moveScene = useStageStore((state) => state.moveScene);
  const moveSceneTo = useStageStore((state) => state.moveSceneTo);
  const addObject = useStageStore((state) => state.addObject);
  const addCharacter = useStageStore((state) => state.addCharacter);
  const moveObject = useStageStore((state) => state.moveObject);
  const moveCharacter = useStageStore((state) => state.moveCharacter);
  const updateObject = useStageStore((state) => state.updateObject);
  const updateCharacter = useStageStore((state) => state.updateCharacter);
  const removeObject = useStageStore((state) => state.removeObject);
  const removeCharacter = useStageStore((state) => state.removeCharacter);
  const reorderObject = useStageStore((state) => state.reorderObject);
  const reorderCharacter = useStageStore((state) => state.reorderCharacter);
  const clearLimitNotice = useStageStore((state) => state.clearLimitNotice);
  const setBackground = useStageStore((state) => state.setBackground);
  const fitTo = useStageStore((state) => state.fitTo);
  const zoom = useStageStore((state) => state.zoom);
  const pan = useStageStore((state) => state.pan);
  const toggleSafeArea = useStageStore((state) => state.toggleSafeArea);
  const saveStageNow = useStageStore((state) => state.saveNow);
  const canUndo = useStageStore((state) => state.historyPast.length > 0);
  const canRedo = useStageStore((state) => state.historyFuture.length > 0);
  const undoLabel = useStageStore((state) => state.historyPast[state.historyPast.length - 1]?.label ?? '');
  const redoLabel = useStageStore((state) => state.historyFuture[state.historyFuture.length - 1]?.label ?? '');
  const undo = useStageStore((state) => state.undo);
  const redo = useStageStore((state) => state.redo);
  const beginBatch = useStageStore((state) => state.beginBatch);
  const endBatch = useStageStore((state) => state.endBatch);
  const applyServerStage = useStageStore((state) => state.applyServerStage);

  const audioFile = useAudioStore((state) => state.audio);
  const ttsProviders = useAudioStore((state) => state.providers);
  const loadAudio = useAudioStore((state) => state.load);
  const setAudioFile = useAudioStore((state) => state.setAudio);
  // 用 useMemo 固定引用，避免 zustand selector 每次返回新对象导致重复渲染。
  const audioEnvelopes = useMemo(() => buildAudioEnvelopes(audioFile), [audioFile]);
  const readyAudio = useMemo(() => buildReadyAudio(audioFile), [audioFile]);

  const [activeTab, setActiveTab] = useState<ResourceTab>('prop');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [editorCharacterId, setEditorCharacterId] = useState<string | null>(null);
  const [ttsOpen, setTtsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sceneEditor, setSceneEditor] = useState<{
    sceneId: string;
    focus: SceneEditFocus;
  } | null>(null);
  const [sceneDeleteId, setSceneDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    useTimelineStore.getState().reset();
    void loadProject(projectId);
    void loadStage(projectId);
    void loadAudio(projectId);
  }, [projectId, loadProject, loadStage, loadAudio]);

  // 项目名称与舞台布局各自防抖自动保存，互不覆盖。
  useEffect(() => {
    if (editorSaveStatus !== 'dirty') return;
    const timer = window.setTimeout(() => void saveProjectNow(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draftName, editorSaveStatus, saveProjectNow]);

  useEffect(() => {
    if (stageSaveStatus !== 'dirty') return;
    const timer = window.setTimeout(() => void saveStageNow(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [stage, stageSaveStatus, saveStageNow]);

  useEffect(() => {
    const isTyping = (target: EventTarget | null): boolean =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveProjectNow();
        void saveStageNow();
        return;
      }
      // 文本框内的 Ctrl+Z 交给浏览器撤销输入，不劫持为编辑器历史。
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'z' &&
        !isTyping(event.target)
      ) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !isTyping(event.target)) {
        if (selectedId) {
          event.preventDefault();
          setDeleteConfirmId(selectedId);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveProjectNow, saveStageNow, selectedId, undo, redo]);

  const combinedStatus: SaveStatus =
    editorSaveStatus === 'error' || stageSaveStatus === 'error'
      ? 'error'
      : editorSaveStatus === 'saving' || stageSaveStatus === 'saving'
        ? 'saving'
        : editorSaveStatus === 'dirty' || stageSaveStatus === 'dirty'
          ? 'dirty'
          : 'saved';

  const saveAll = () => {
    void saveProjectNow();
    void saveStageNow();
  };

  /**
   * 配音生成结果已在服务端落盘：直接应用返回的动画数据与音频索引，
   * 不触发多余的自动保存；仍纳入撤销历史，允许回退时间轴更新。
   */
  const handleGenerated = (result: TtsGenerateResult) => {
    applyServerStage(result.stage, '生成配音并更新时间轴');
    setAudioFile(result.audio);
  };

  /** 场景切换 / 新建 / 删除当前场景后，旧场景的播放头、选中与弹窗都不再适用。 */
  const resetSceneView = () => {
    const timeline = useTimelineStore.getState();
    timeline.setPlaying(false);
    timeline.setCurrentFrame(0);
    timeline.selectDialogue(null);
    setDeleteConfirmId(null);
    setEditorCharacterId(null);
  };

  /**
   * 场景结构变更会改变服务端读取到的 activeSceneId 与场景顺序，
   * 因此立即落盘而不等 2 秒防抖，避免紧接着打开导出 / 配音时读到旧数据。
   */
  const commitSceneChange = () => void saveStageNow();

  const handleSelectScene = (sceneId: string) => {
    const before = useStageStore.getState().stage?.activeSceneId ?? null;
    setActiveScene(sceneId);
    const after = useStageStore.getState().stage?.activeSceneId ?? null;
    if (before === after) return;
    resetSceneView();
    commitSceneChange();
  };

  const handleAddScene = () => {
    const id = addScene();
    if (!id) return;
    resetSceneView();
    commitSceneChange();
  };

  const handleDuplicateScene = (sceneId: string) => {
    const id = duplicateScene(sceneId);
    if (!id) return;
    resetSceneView();
    commitSceneChange();
  };

  const handleSceneMove = (sceneId: string, direction: 'left' | 'right') => {
    moveScene(sceneId, direction);
    commitSceneChange();
  };

  const handleSceneMoveTo = (sceneId: string, targetIndex: number) => {
    moveSceneTo(sceneId, targetIndex);
    commitSceneChange();
  };

  const handleSceneEdit = (sceneId: string, focus: SceneEditFocus) =>
    setSceneEditor({ sceneId, focus });

  const handleSceneSave = (patch: SceneEditorPatch) => {
    if (!sceneEditor) return;
    updateScene(sceneEditor.sceneId, patch);
    setSceneEditor(null);
    commitSceneChange();
  };

  const confirmDeleteScene = () => {
    if (!sceneDeleteId) return;
    const before = useStageStore.getState().stage?.activeSceneId ?? null;
    deleteScene(sceneDeleteId);
    const after = useStageStore.getState().stage?.activeSceneId ?? null;
    if (before !== after) resetSceneView();
    setSceneDeleteId(null);
    commitSceneChange();
  };

  if (!project) {
    return (
      <FullScreenNotice
        title={loadError ? '无法打开项目' : '正在打开项目…'}
        message={loadError ?? '正在读取项目数据，请稍候。'}
        action={
          loadError ? (
            <Link to="/">
              <Button variant="primary">返回项目首页</Button>
            </Link>
          ) : null
        }
      />
    );
  }

  const sceneAssets = assets.filter((asset) => asset.kind === 'scene');
  const propAssets = assets.filter((asset) => asset.kind === 'prop');
  const selected: StageObject | null = scene?.objects.find((item) => item.id === selectedId) ?? null;
  const selectedAsset = selected ? (assets.find((item) => item.id === selected.assetId) ?? null) : null;
  const selectedCharacter = scene?.characters.find((item) => item.id === selectedId) ?? null;
  const characterAsset = selectedCharacter
    ? (characters.find((item) => item.id === selectedCharacter.assetId) ?? null)
    : null;
  const characterHeight =
    selectedCharacter && characterAsset
      ? characterDisplayHeight(selectedCharacter, characterAsset)
      : null;
  const characterCount = scene?.characters.length ?? 0;
  const orderedCount = (scene?.objects.length ?? 0) + characterCount;
  const selectedZIndex = selectedCharacter?.zIndex ?? selected?.zIndex ?? 0;

  const confirmDelete = () => {
    if (!deleteConfirmId) return;
    if (scene?.characters.some((item) => item.id === deleteConfirmId)) {
      removeCharacter(deleteConfirmId);
    } else {
      removeObject(deleteConfirmId);
    }
    select(null);
    setDeleteConfirmId(null);
  };

  const deleteTargetName =
    scene?.objects.find((item) => item.id === deleteConfirmId)?.name ??
    scene?.characters.find((item) => item.id === deleteConfirmId)?.name ??
    '该对象';

  const editorInstance = scene?.characters.find((item) => item.id === editorCharacterId) ?? null;
  const editorCharacterAsset = editorInstance
    ? (characters.find((item) => item.id === editorInstance.assetId) ?? null)
    : null;

  const sceneDeleteTarget = stage?.scenes.find((item) => item.id === sceneDeleteId) ?? null;
  const sceneEditorScene = stage?.scenes.find((item) => item.id === sceneEditor?.sceneId) ?? null;
  const sceneEditorIndex = stage?.scenes.findIndex((item) => item.id === sceneEditor?.sceneId) ?? -1;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-panel px-4">
        <Link to="/" className="text-sm text-muted hover:text-ink">
          ← 返回
        </Link>
        <span className="h-5 w-px bg-line" />
        <Link
          to={`/projects/${projectId}/script`}
          className="text-sm text-muted hover:text-ink"
        >
          剧本编辑
        </Link>
        <span className="h-5 w-px bg-line" />
        <input
          aria-label="项目名称"
          className="w-56 rounded border border-transparent bg-transparent px-2 py-1 text-sm text-ink hover:border-line"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
        />
        <StatusBadge status={combinedStatus} />

        <div className="ml-2 flex items-center gap-1.5">
          <Button
            variant="ghost"
            disabled={!canUndo}
            title={canUndo ? `撤销：${undoLabel}（Ctrl+Z）` : '没有可撤销的操作'}
            onClick={undo}
          >
            撤销
          </Button>
          <Button
            variant="ghost"
            disabled={!canRedo}
            title={canRedo ? `重做：${redoLabel}（Ctrl+Shift+Z）` : '没有可重做的操作'}
            onClick={redo}
          >
            重做
          </Button>
          <Button
            variant="secondary"
            loading={combinedStatus === 'saving'}
            onClick={saveAll}
          >
            保存
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            title="从第 0 帧开始播放预览（阶段 6 确定性帧状态）"
            onClick={() => {
              const timeline = useTimelineStore.getState();
              timeline.setCurrentFrame(0);
              timeline.setPlaying(true);
            }}
          >
            预览
          </Button>
          <Button
            title="生成配音：先预览时间轴更新影响，确认后按音频真实时长回写"
            onClick={() => setTtsOpen(true)}
          >
            生成配音
          </Button>
          <Button
            title="导出 MP4：先做导出前检查，再按真实渲染进度输出 H.264 + AAC 视频"
            onClick={() => setExportOpen(true)}
          >
            导出视频
          </Button>
        </div>
      </header>

      <SceneTabBar
        scenes={stage?.scenes ?? []}
        assets={assets}
        activeSceneId={scene?.id ?? null}
        loading={stageLoading}
        onSelect={handleSelectScene}
        onAdd={handleAddScene}
        onDuplicate={handleDuplicateScene}
        onMove={handleSceneMove}
        onMoveTo={handleSceneMoveTo}
        onEdit={handleSceneEdit}
        onDelete={setSceneDeleteId}
      />

      {combinedStatus === 'error' && (saveError || stageSaveError) && (
        <div className="flex shrink-0 items-center gap-3 border-b border-danger bg-panel px-4 py-2 text-xs">
          <span className="text-danger">
            保存失败：{[saveError, stageSaveError].filter(Boolean).join('；')}
          </span>
          <button type="button" className="text-ink underline" onClick={saveAll}>
            重试
          </button>
        </div>
      )}

      {stageLoadError && (
        <div className="flex shrink-0 items-center gap-3 border-b border-danger bg-panel px-4 py-2 text-xs">
          <span className="text-danger">舞台数据读取失败：{stageLoadError}</span>
          <button
            type="button"
            className="text-ink underline"
            onClick={() => projectId && void loadStage(projectId)}
          >
            重试
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <ResourcePanel
          activeTab={activeTab}
          onTabChange={setActiveTab}
          sceneAssets={sceneAssets}
          propAssets={propAssets}
          characterAssets={characters}
          currentBackgroundId={scene?.backgroundAssetId ?? null}
          onSetBackground={setBackground}
          onAddProp={(assetId) => addObject(assetId)}
          onAddCharacter={(assetId) => addCharacter(assetId)}
          objectCount={scene?.objects.length ?? 0}
          characterCount={characterCount}
          limitNotice={limitNotice}
          onClearLimitNotice={clearLimitNotice}
        />

        <section className="relative min-w-0 flex-1 overflow-hidden bg-page">
          {scene ? (
            <PixiStage
              scene={scene}
              assets={assets}
              characters={characters}
              viewport={viewport}
              selectedId={selectedId}
              showSafeArea={showSafeArea}
              onSelect={select}
              onMove={(id, x, y) => {
                if (scene.characters.some((item) => item.id === id)) moveCharacter(id, x, y);
                else moveObject(id, x, y);
              }}
              onZoom={zoom}
              onPan={pan}
              onFit={fitTo}
              onToggleSafeArea={toggleSafeArea}
              onDropAsset={(assetId, point) => {
                if (characters.some((item) => item.id === assetId)) addCharacter(assetId, point);
                else addObject(assetId, point);
              }}
              onOpenCharacter={setEditorCharacterId}
              onDragStart={() => beginBatch('拖动对象')}
              onDragEnd={endBatch}
              audioEnvelopes={audioEnvelopes}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-ink">
                {stageLoadError ? '舞台数据无法读取' : stageLoading ? '正在读取舞台数据…' : '暂无舞台数据'}
              </p>
              {!stageLoading && !stageLoadError && projectId && (
                <Button onClick={() => void loadStage(projectId)}>重新加载</Button>
              )}
            </div>
          )}
        </section>

        <PropertyPanel
          selected={selected}
          asset={selectedAsset}
          selectedCharacter={selectedCharacter}
          characterAsset={characterAsset}
          characterHeight={characterHeight}
          sceneCount={stage?.scenes.length ?? 0}
          project={project}
          ttsProviders={ttsProviders}
          onUpdate={(patch) => selected && updateObject(selected.id, patch)}
          onUpdateCharacter={(patch) =>
            selectedCharacter && updateCharacter(selectedCharacter.id, patch)
          }
          onOpenCharacterEditor={() =>
            selectedCharacter && setEditorCharacterId(selectedCharacter.id)
          }
          onReorder={(direction) => {
            if (selectedCharacter) reorderCharacter(selectedCharacter.id, direction);
            else if (selected) reorderObject(selected.id, direction);
          }}
          onRemove={() => {
            const id = selectedCharacter?.id ?? selected?.id;
            if (id) setDeleteConfirmId(id);
          }}
          canMoveUp={selectedZIndex < orderedCount - 1}
          canMoveDown={selectedZIndex > 0}
        />
      </div>

      <footer className="h-[280px] shrink-0 border-t border-line bg-panel">
        {scene ? (
          <TimelinePanel scene={scene} audioAssets={readyAudio} />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted">
            {stageLoadError ? '舞台数据无法读取，时间轴不可用' : '正在读取舞台数据…'}
          </div>
        )}
      </footer>

      <Modal
        open={deleteConfirmId !== null}
        title="删除对象"
        onClose={() => setDeleteConfirmId(null)}
        footer={
          <>
            <Button onClick={() => setDeleteConfirmId(null)}>取消</Button>
            <Button variant="danger" onClick={confirmDelete}>
              确认删除
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6 text-ink">确定从当前场景删除「{deleteTargetName}」吗？</p>
        <p className="mt-2 text-xs leading-6 text-muted">
          舞台布局会立即更新并自动保存；删除后可按 Ctrl+Z 撤销恢复。
        </p>
      </Modal>

      <Modal
        open={sceneDeleteId !== null && sceneDeleteTarget !== null}
        title="删除场景"
        onClose={() => setSceneDeleteId(null)}
        footer={
          <>
            <Button onClick={() => setSceneDeleteId(null)}>取消</Button>
            <Button
              variant="danger"
              data-testid="scene-delete-confirm"
              onClick={confirmDeleteScene}
            >
              确认删除场景
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6 text-ink">
          确定删除场景「{sceneDeleteTarget?.name}」吗？
        </p>
        <div
          data-testid="scene-delete-impact"
          className="mt-3 space-y-1.5 rounded border border-line bg-page p-3 text-xs leading-6 text-muted"
        >
          <p>
            该场景内包含 {sceneDeleteTarget?.dialogueEvents.length ?? 0} 句对白 ·{' '}
            {sceneDeleteTarget?.characters.length ?? 0} 个人物 ·{' '}
            {sceneDeleteTarget?.objects.length ?? 0} 个道具，将随场景一起移除。
          </p>
          <p>删除后其余场景自动前移，全局时间轴与导出拼接顺序同步变化。</p>
          <p>项目素材与已生成的音频文件不会被删除；可按 Ctrl+Z 撤销恢复。</p>
        </div>
      </Modal>

      <CharacterEditorModal
        open={editorCharacterId !== null && editorInstance !== null}
        character={editorCharacterAsset}
        instance={editorInstance}
        onClose={() => setEditorCharacterId(null)}
        onUpdate={(patch) => editorInstance && updateCharacter(editorInstance.id, patch)}
      />

      <SceneEditorModal
        open={sceneEditor !== null && sceneEditorScene !== null}
        scene={sceneEditorScene}
        index={sceneEditorIndex >= 0 ? sceneEditorIndex : 0}
        sceneCount={stage?.scenes.length ?? 0}
        assets={sceneAssets}
        focus={sceneEditor?.focus ?? 'name'}
        onClose={() => setSceneEditor(null)}
        onSave={handleSceneSave}
      />

      <TtsDialog
        open={ttsOpen}
        projectId={projectId ?? ''}
        providers={ttsProviders}
        onClose={() => setTtsOpen(false)}
        onGenerated={handleGenerated}
      />

      <ExportDialog
        open={exportOpen}
        projectId={projectId ?? ''}
        projectName={project?.name ?? draftName}
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
}

function FullScreenNotice({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action: ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-page px-8">
      <h1 className="text-lg text-ink">{title}</h1>
      <p className="max-w-[520px] text-center text-sm text-muted">{message}</p>
      {action}
    </div>
  );
}
