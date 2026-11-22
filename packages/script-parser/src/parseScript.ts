import { MAX_CHARACTERS_PER_SCENE, POSTURE_LABELS, scriptDraftSchema } from '@animation/shared';
import type {
  DraftCharacter,
  DraftDialogue,
  DraftScene,
  ParseError,
  ParseErrorType,
  Posture,
  ScriptDraft,
} from '@animation/shared';

/**
 * 固定格式剧本解析器（PRD 9 节 / 架构 5.3、6.2）。
 *
 * 纯逻辑模块：按行扫描，识别场景、角色、对白与姿态，处理姿态继承并校验规则。
 * 不负责坐标、场景布局、素材绘制、分镜推理、动画时长与 TTS，也不得触碰
 * PixiJS / DOM。不使用时间、随机数或 IO，相同输入必得相同结果。
 *
 * 语法（第一版）：
 *   # 场景：客厅
 *   # 角色：老王、小李
 *   老王（坐着）：你回来了？
 *   小李：我不知道啊。
 * 姿态可省略，省略时沿用该角色本场景内最近一次有效姿态；首次默认站立。
 */

/** 兼容中英文冒号、半角/全角括号、行首行尾空格。 */
const SCENE_PATTERN = /^#\s*场景\s*[:：]\s*(.*)$/;
const CHARACTERS_PATTERN = /^#\s*角色\s*[:：]\s*(.*)$/;
const DIALOGUE_PATTERN = /^([^（()：:]+?)\s*(?:[（(]\s*([^）)]*?)\s*[）)])?\s*[:：]\s*(.*)$/;
/** PRD 9.2：支持中文顿号、中文逗号、英文逗号。 */
const CHARACTER_SEPARATOR = /[、,，]/;

const DEFAULT_POSTURE: Posture = 'standing';

/** POSTURE_LABELS 反查，严格只接受「站着」「坐着」，其他一律报错。 */
const POSTURE_BY_LABEL = new Map<string, Posture>(
  (Object.entries(POSTURE_LABELS) as Array<[Posture, string]>).map(
    ([value, label]): [string, Posture] => [label, value],
  ),
);

interface SceneState {
  scene: DraftScene;
  sourceLine: number;
  characterByName: Map<string, DraftCharacter>;
  /** 姿态继承：每个场景独立重置，避免跨场景串味。 */
  lastPosture: Map<string, Posture>;
  firstDialogueSeen: Set<string>;
  limitReported: boolean;
}

function makeError(line: number, type: ParseErrorType, message: string): ParseError {
  return { line, type, message };
}

function finalizeScene(state: SceneState, warnings: string[]): void {
  if (state.scene.dialogues.length === 0) {
    warnings.push(`第 ${state.sourceLine} 行：场景「${state.scene.name}」没有对白。`);
  }
  for (const character of state.scene.characters) {
    if (!state.firstDialogueSeen.has(character.name)) {
      warnings.push(`第 ${character.sourceLine} 行：角色「${character.name}」已声明但没有对白。`);
    }
  }
}

/**
 * 解析原始剧本文本，返回 ScriptDraft。
 * 所有 ID 按出现顺序确定性生成（scene-N / char-N-M / dlg-N-M），不使用随机数。
 */
export function parseScript(text: string): ScriptDraft {
  const lines = text.split(/\r\n|\n|\r/);
  const scenes: DraftScene[] = [];
  const errors: ParseError[] = [];
  const warnings: string[] = [];

  let current: SceneState | null = null;
  let dialogueSequence = 0;

  /** 收尾上一个场景；置空避免循环结束时重复收集 warnings。 */
  const closeCurrent = (): void => {
    if (current) {
      finalizeScene(current, warnings);
      current = null;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index].trim();
    if (line.length === 0) continue;

    // 1. 场景声明
    const sceneMatch = SCENE_PATTERN.exec(line);
    if (sceneMatch) {
      const name = sceneMatch[1].trim();
      if (!name) {
        errors.push(makeError(lineNumber, 'scene', '场景名称不能为空，请写成「# 场景：客厅」。'));
        continue;
      }
      closeCurrent();
      const scene: DraftScene = {
        id: `scene-${scenes.length + 1}`,
        name,
        characters: [],
        dialogues: [],
      };
      scenes.push(scene);
      current = {
        scene,
        sourceLine: lineNumber,
        characterByName: new Map(),
        lastPosture: new Map(),
        firstDialogueSeen: new Set(),
        limitReported: false,
      };
      continue;
    }

    // 2. 角色声明
    const charactersMatch = CHARACTERS_PATTERN.exec(line);
    if (charactersMatch) {
      if (!current) {
        errors.push(makeError(lineNumber, 'scene', '角色声明必须位于「# 场景：」之后，请先声明场景。'));
        continue;
      }
      const parts = charactersMatch[1].split(CHARACTER_SEPARATOR).map((part) => part.trim());
      if (parts.length === 0 || parts.some((part) => part.length === 0)) {
        errors.push(
          makeError(lineNumber, 'character', '角色名称不能为空；多个角色请用「、」或「,」分隔。'),
        );
      }
      for (const name of parts) {
        if (!name) continue;
        if (current.characterByName.has(name)) {
          errors.push(
            makeError(lineNumber, 'character', `角色「${name}」在同一场景中重复声明，请删除重复项。`),
          );
          continue;
        }
        const character: DraftCharacter = {
          id: `char-${scenes.length}-${current.scene.characters.length + 1}`,
          name,
          initialPosture: DEFAULT_POSTURE,
          sourceLine: lineNumber,
        };
        current.scene.characters.push(character);
        current.characterByName.set(name, character);
      }
      // 超限只报一次，但绝不静默截断：超出的角色仍保留在草稿里供用户查看。
      if (!current.limitReported && current.scene.characters.length > MAX_CHARACTERS_PER_SCENE) {
        errors.push(
          makeError(
            lineNumber,
            'limit',
            `每场景最多 ${MAX_CHARACTERS_PER_SCENE} 个角色，当前 ${current.scene.characters.length} 个；请删减后重新解析。`,
          ),
        );
        current.limitReported = true;
      }
      continue;
    }

    // 3. 未知指令行（普通叙述文字也不能自动转成动作）
    if (line.startsWith('#')) {
      errors.push(
        makeError(lineNumber, 'syntax', '不支持的指令行；第一版只支持「# 场景：」和「# 角色：」。'),
      );
      continue;
    }

    // 4. 对白行
    const dialogueMatch = DIALOGUE_PATTERN.exec(line);
    if (!dialogueMatch) {
      errors.push(
        makeError(lineNumber, 'syntax', '无法识别的行；对白格式为「角色名（姿态）：对白内容」，姿态可省略。'),
      );
      continue;
    }

    if (!current) {
      errors.push(makeError(lineNumber, 'scene', '对白必须位于「# 场景：」之后，请先声明场景。'));
      continue;
    }

    const name = dialogueMatch[1].trim();
    const rawPosture = dialogueMatch[2];
    const dialogueText = dialogueMatch[3].trim();

    if (!name) {
      errors.push(makeError(lineNumber, 'syntax', '对白缺少角色名，请写成「老王（坐着）：台词」。'));
      continue;
    }

    const character = current.characterByName.get(name);
    if (!character) {
      errors.push(
        makeError(lineNumber, 'character', `角色「${name}」未在当前场景声明；请先用「# 角色：」声明。`),
      );
    }

    // 姿态：省略则继承；非法值报错但不猜测，沿用上一次有效姿态且不污染继承链。
    let posture: Posture = current.lastPosture.get(name) ?? DEFAULT_POSTURE;
    let postureValid = true;
    if (rawPosture !== undefined) {
      const label = rawPosture.trim();
      if (!label) {
        postureValid = false;
        errors.push(
          makeError(
            lineNumber,
            'posture',
            '姿态不能为空；可用「站着」「坐着」，或省略括号沿用上一次姿态。',
          ),
        );
      } else {
        const mapped = POSTURE_BY_LABEL.get(label);
        if (!mapped) {
          postureValid = false;
          errors.push(
            makeError(
              lineNumber,
              'posture',
              `不支持的姿态「${label}」；第一版只支持「站着」「坐着」。`,
            ),
          );
        } else {
          posture = mapped;
        }
      }
    }

    if (!dialogueText) {
      errors.push(makeError(lineNumber, 'syntax', '对白内容不得为空，请在冒号后填写台词。'));
    }

    // 未声明角色 / 空对白都已有明确错误，不生成无意义的对白事件。
    if (!character || !dialogueText) continue;

    if (postureValid) current.lastPosture.set(name, posture);
    if (!current.firstDialogueSeen.has(name)) {
      character.initialPosture = posture;
      current.firstDialogueSeen.add(name);
    }

    dialogueSequence += 1;
    const dialogue: DraftDialogue = {
      id: `dlg-${scenes.length}-${current.scene.dialogues.length + 1}`,
      characterId: character.id,
      text: dialogueText,
      posture,
      sequence: dialogueSequence,
      sourceLine: lineNumber,
    };
    current.scene.dialogues.push(dialogue);
  }

  closeCurrent();

  if (lines.every((line) => line.trim().length === 0)) {
    errors.push(makeError(1, 'scene', '剧本为空，请先用「# 场景：客厅」声明场景并写入对白。'));
  }

  // 输出前做一次运行时 Schema 校验，防止草稿结构与共享契约漂移。
  return scriptDraftSchema.parse({ scenes, errors, warnings });
}
