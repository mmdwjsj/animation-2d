import { describe, expect, it } from 'vitest';
import { scriptDraftSchema } from '@animation/shared';
import { parseScript } from './parseScript';

/** PRD 15 节标准验收剧本。 */
const ACCEPTANCE_SCRIPT = `# 场景：客厅

# 角色：老王、小李

老王（坐着）：你回来了？
小李（站着）：我的蛋糕呢？
老王：我不知道啊。
小李：那你嘴角的奶油是什么？
老王（站着）：这是牙膏！`;

describe('parseScript · PRD 15 标准验收剧本', () => {
  it('识别 1 个场景、2 个角色、5 句对白且无阻断错误', () => {
    const draft = parseScript(ACCEPTANCE_SCRIPT);

    expect(draft.errors).toEqual([]);
    expect(draft.warnings).toEqual([]);
    expect(draft.scenes).toHaveLength(1);
    const scene = draft.scenes[0];
    expect(scene.id).toBe('scene-1');
    expect(scene.name).toBe('客厅');
    expect(scene.characters.map((c) => c.name)).toEqual(['老王', '小李']);
    expect(scene.dialogues).toHaveLength(5);
  });

  it('角色初始姿态按首句对白确定，ID 全部确定性生成', () => {
    const { characters, dialogues } = parseScript(ACCEPTANCE_SCRIPT).scenes[0];

    expect(characters.map((c) => [c.id, c.name, c.initialPosture, c.sourceLine])).toEqual([
      ['char-1-1', '老王', 'sitting', 3],
      ['char-1-2', '小李', 'standing', 3],
    ]);
    expect(dialogues.map((d) => [d.id, d.characterId, d.sequence])).toEqual([
      ['dlg-1-1', 'char-1-1', 1],
      ['dlg-1-2', 'char-1-2', 2],
      ['dlg-1-3', 'char-1-1', 3],
      ['dlg-1-4', 'char-1-2', 4],
      ['dlg-1-5', 'char-1-1', 5],
    ]);
  });

  it('第三句老王继承坐姿、第五句切回站姿，文本与源行号准确', () => {
    const { dialogues } = parseScript(ACCEPTANCE_SCRIPT).scenes[0];

    expect(dialogues.map((d) => d.posture)).toEqual([
      'sitting',
      'standing',
      'sitting',
      'standing',
      'standing',
    ]);
    expect(dialogues.map((d) => d.text)).toEqual([
      '你回来了？',
      '我的蛋糕呢？',
      '我不知道啊。',
      '那你嘴角的奶油是什么？',
      '这是牙膏！',
    ]);
    expect(dialogues.map((d) => d.sourceLine)).toEqual([5, 6, 7, 8, 9]);
  });

  it('输出通过共享 ScriptDraft Schema 运行时校验', () => {
    expect(() => scriptDraftSchema.parse(parseScript(ACCEPTANCE_SCRIPT))).not.toThrow();
  });
});

describe('parseScript · 确定性与格式兼容', () => {
  it('相同输入重复解析得到完全相同的结果（无随机 / 时间依赖）', () => {
    expect(parseScript(ACCEPTANCE_SCRIPT)).toEqual(parseScript(ACCEPTANCE_SCRIPT));
  });

  it('Windows CRLF 与 BOM 不影响解析结果', () => {
    const expected = parseScript(ACCEPTANCE_SCRIPT);
    expect(parseScript(ACCEPTANCE_SCRIPT.replace(/\n/g, '\r\n'))).toEqual(expected);
    expect(parseScript(`\uFEFF${ACCEPTANCE_SCRIPT}`)).toEqual(expected);
  });

  it('空行、行首行尾空格、中英文标点与中英文分隔符均可解析', () => {
    const script = [
      '   # 场景： 客厅   ',
      '',
      ' # 角色： 老王,小李 ， 张三  ',
      '',
      '老王 ( 坐着 ) : Hello, world! 你回来啦？',
      '小李：Hi!  It\'s  fine. 你好，世界。',
      '  张三  ：  全角冒号：也 OK  ',
    ].join('\n');
    const draft = parseScript(script);

    expect(draft.errors).toEqual([]);
    const scene = draft.scenes[0];
    expect(scene.name).toBe('客厅');
    expect(scene.characters.map((c) => c.name)).toEqual(['老王', '小李', '张三']);
    expect(scene.dialogues.map((d) => d.text)).toEqual([
      'Hello, world! 你回来啦？',
      'Hi!  It\'s  fine. 你好，世界。',
      '全角冒号：也 OK',
    ]);
    expect(scene.dialogues[0].posture).toBe('sitting');
    expect(scene.dialogues.map((d) => d.sourceLine)).toEqual([5, 6, 7]);
  });

  it('多场景按顺序生成，姿态继承在每个场景内独立重置', () => {
    const draft = parseScript(
      [
        '# 场景：客厅',
        '# 角色：老王',
        '老王（坐着）：一',
        '# 场景：厨房',
        '# 角色：老王',
        '老王：二',
      ].join('\n'),
    );

    expect(draft.errors).toEqual([]);
    expect(draft.scenes.map((s) => [s.id, s.name])).toEqual([
      ['scene-1', '客厅'],
      ['scene-2', '厨房'],
    ]);
    expect(draft.scenes[0].dialogues[0].posture).toBe('sitting');
    expect(draft.scenes[1].dialogues[0].posture).toBe('standing');
    expect(draft.scenes[1].characters[0].id).toBe('char-2-1');
    expect(draft.scenes[1].dialogues[0].id).toBe('dlg-2-1');
    expect(draft.scenes[1].dialogues[0].sequence).toBe(2);
  });
});

describe('parseScript · 姿态继承（PRD 9.5）', () => {
  it('坐、坐、坐、站、站：省略姿态时沿用最近一次有效姿态', () => {
    const draft = parseScript(
      [
        '# 场景：客厅',
        '# 角色：老王',
        '老王（坐着）：你回来了？',
        '老王：吃饭了吗？',
        '老王：今天怎么样？',
        '老王（站着）：我去拿水。',
        '老王：等一下。',
      ].join('\n'),
    );

    expect(draft.errors).toEqual([]);
    expect(draft.scenes[0].dialogues.map((d) => d.posture)).toEqual([
      'sitting',
      'sitting',
      'sitting',
      'standing',
      'standing',
    ]);
    expect(draft.scenes[0].characters[0].initialPosture).toBe('sitting');
  });

  it('角色首次出现且未指定姿态时默认站立', () => {
    const draft = parseScript(['# 场景：客厅', '# 角色：老王', '老王：你好'].join('\n'));
    expect(draft.scenes[0].dialogues[0].posture).toBe('standing');
    expect(draft.scenes[0].characters[0].initialPosture).toBe('standing');
  });
});

describe('parseScript · 错误类型与原始行号', () => {
  it('缺少场景：对白在场景声明之前报 scene 错误且不生成场景', () => {
    const draft = parseScript('老王：你好');
    expect(draft.scenes).toEqual([]);
    expect(draft.errors).toEqual([
      { line: 1, type: 'scene', message: expect.stringContaining('场景') },
    ]);
  });

  it('角色声明在场景之前报 scene 错误，无效声明导致后续对白再报 character 错误', () => {
    const draft = parseScript(['# 角色：老王', '# 场景：客厅', '老王：你好'].join('\n'));
    expect(draft.errors.map((e) => [e.line, e.type])).toEqual([
      [1, 'scene'],
      [3, 'character'],
    ]);
    expect(draft.scenes).toHaveLength(1);
    expect(draft.scenes[0].characters).toEqual([]);
    expect(draft.scenes[0].dialogues).toEqual([]);
  });

  it('未声明角色：报 character 错误，不自动创建角色', () => {
    const draft = parseScript(
      ['# 场景：客厅', '# 角色：老王', '老王：你好', '小李：我没被声明'].join('\n'),
    );
    expect(draft.errors).toEqual([
      { line: 4, type: 'character', message: expect.stringContaining('小李') },
    ]);
    expect(draft.scenes[0].characters.map((c) => c.name)).toEqual(['老王']);
    expect(draft.scenes[0].dialogues).toHaveLength(1);
  });

  it('非法姿态：报错但按继承规则生成对白，不猜测动作', () => {
    const draft = parseScript(
      ['# 场景：客厅', '# 角色：老王', '老王（坐着）：一', '老王（躺着）：二', '老王：三'].join('\n'),
    );
    expect(draft.errors).toEqual([
      { line: 4, type: 'posture', message: expect.stringContaining('躺着') },
    ]);
    expect(draft.scenes[0].dialogues.map((d) => d.posture)).toEqual([
      'sitting',
      'sitting',
      'sitting',
    ]);
  });

  it('空姿态括号与内部英文值都视为非法姿态', () => {
    const draft = parseScript(
      ['# 场景：客厅', '# 角色：老王', '老王（）：一', '老王(sitting)：二'].join('\n'),
    );
    expect(draft.errors.map((e) => [e.line, e.type])).toEqual([
      [3, 'posture'],
      [4, 'posture'],
    ]);
  });

  it('空对白：报 syntax 错误且不生成对白事件', () => {
    const draft = parseScript(['# 场景：客厅', '# 角色：老王', '老王：   '].join('\n'));
    expect(draft.errors).toEqual([
      { line: 3, type: 'syntax', message: expect.stringContaining('不得为空') },
    ]);
    expect(draft.scenes[0].dialogues).toEqual([]);
  });

  it('超过 4 个角色：报 limit 错误且不静默截断角色列表', () => {
    const draft = parseScript(
      ['# 场景：客厅', '# 角色：甲、乙、丙、丁、戊', '甲：一'].join('\n'),
    );
    expect(draft.errors).toEqual([
      { line: 2, type: 'limit', message: expect.stringContaining('最多 4 个角色') },
    ]);
    expect(draft.scenes[0].characters).toHaveLength(5);
    expect(draft.scenes[0].characters.map((c) => c.name)).toEqual(['甲', '乙', '丙', '丁', '戊']);
  });

  it('恰好 4 个角色不报数量错误', () => {
    const draft = parseScript(
      ['# 场景：客厅', '# 角色：甲、乙、丙、丁', '甲：一'].join('\n'),
    );
    expect(draft.errors).toEqual([]);
    expect(draft.scenes[0].characters).toHaveLength(4);
  });

  it('空场景名、空角色名、重复角色名分别给出可理解错误', () => {
    const draft = parseScript(
      ['# 场景：', '# 场景：客厅', '# 角色：老王、、小李', '# 角色：老王'].join('\n'),
    );
    expect(draft.errors.map((e) => [e.line, e.type])).toEqual([
      [1, 'scene'],
      [3, 'character'],
      [4, 'character'],
    ]);
    expect(draft.errors[1].message).toContain('不能为空');
    expect(draft.errors[2].message).toContain('重复声明');
    expect(draft.scenes).toHaveLength(1);
    expect(draft.scenes[0].characters.map((c) => c.name)).toEqual(['老王', '小李']);
  });

  it('未知指令与普通叙述文字报语法错误，不自动转成动作', () => {
    const draft = parseScript(
      ['# 场景：客厅', '# 角色：老王', '# 注释：随便写', '今天天气很好', '老王：你好'].join('\n'),
    );
    expect(draft.errors.map((e) => [e.line, e.type])).toEqual([
      [3, 'syntax'],
      [4, 'syntax'],
    ]);
    expect(draft.scenes[0].dialogues).toHaveLength(1);
  });

  it('错误行号包含空行，且可同时定位多个问题', () => {
    const draft = parseScript(
      [
        '',
        '# 场景：客厅',
        '# 角色：老王',
        '',
        '老王（躺着）：一',
        '小王：二',
        '老王：',
        '旁白文字',
      ].join('\n'),
    );
    expect(draft.errors.map((e) => [e.line, e.type])).toEqual([
      [5, 'posture'],
      [6, 'character'],
      [7, 'syntax'],
      [8, 'syntax'],
    ]);
  });

  it('空剧本报缺少场景错误', () => {
    const draft = parseScript('   \n  \n');
    expect(draft.scenes).toEqual([]);
    expect(draft.errors).toEqual([
      { line: 1, type: 'scene', message: expect.stringContaining('剧本为空') },
    ]);
  });
});

describe('parseScript · 非阻断警告', () => {
  it('声明后未说话的角色、没有任何对白的场景给出 warning 但不阻断', () => {
    const draft = parseScript(['# 场景：客厅', '# 角色：老王、小李', '老王：你好'].join('\n'));
    expect(draft.errors).toEqual([]);
    expect(draft.warnings).toHaveLength(1);
    expect(draft.warnings[0]).toContain('小李');
  });

  it('只有场景声明时给出空场景 warning，草稿仍保留场景', () => {
    const draft = parseScript('# 场景：客厅');
    expect(draft.errors).toEqual([]);
    expect(draft.warnings).toHaveLength(1);
    expect(draft.warnings[0]).toContain('没有对白');
    expect(draft.scenes[0].name).toBe('客厅');
  });
});
