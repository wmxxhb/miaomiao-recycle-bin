export const CATEGORIES = ['日常', '移动', '情绪', '睡眠', '技能', '受击'];
export const SCENARIOS = ['入场提醒', '休息待机', '点击互动', '休息结束', '暂不使用'];
const GROUPS = {
  日常: ['Idle', 'CallOut'], 移动: ['Walk', 'Run', 'JumpFall'],
  情绪: ['Alert', 'Anger', 'Fear', 'Happy', 'Relax', 'Sad', 'Shock', 'Show'],
  睡眠: ['SleepStart', 'SleepLoop', 'SleepEnd', 'SleepStand'],
  受击: ['Die', 'Hit2', 'Hit3', 'Stun'],
};
const LOOPS = new Set(['Idle', 'Walk', 'Run', 'SleepLoop', 'Skill1Loop', 'Skill2Loop1', 'Skill2Loop2', 'Skill3Loop', 'Stun']);
export function categoryOf(id) {
  return Object.entries(GROUPS).find(([, ids]) => ids.includes(id))?.[0] || '技能';
}
export const isLoopCandidate = id => LOOPS.has(id);
export const actionKey = (form, clip) => `${form}:${clip}`;
export function matchesFilters(action, filters, decisions = {}) {
  const decision = decisions[action.key] || {};
  const query = (filters.query || '').trim().toLowerCase();
  if (query && !`${action.label} ${action.id} ${action.formName} ${decision.note || ''}`.toLowerCase().includes(query)) return false;
  if (filters.forms?.length && !filters.forms.includes(action.formId)) return false;
  if (filters.categories?.length && !filters.categories.includes(action.category)) return false;
  if (filters.behavior === 'loop' && !action.loopCandidate) return false;
  if (filters.behavior === 'once' && action.loopCandidate) return false;
  if (filters.duration === 'short' && action.durationSeconds > 1) return false;
  if (filters.duration === 'medium' && (action.durationSeconds <= 1 || action.durationSeconds > 3)) return false;
  if (filters.duration === 'long' && action.durationSeconds <= 3) return false;
  if (filters.onlyFavorites && !decision.favorite) return false;
  if (filters.onlyUnassigned && decision.scenarios?.length) return false;
  if (filters.scenarios?.length && !filters.scenarios.some(s => decision.scenarios?.includes(s))) return false;
  return true;
}
export function createActions(catalog) {
  return catalog.forms.flatMap(form => form.clips.map(clip => ({
    ...clip, key: actionKey(form.id, clip.id), formId: form.id, formName: form.name,
    category: categoryOf(clip.id), loopCandidate: isLoopCandidate(clip.id),
  })));
}
export function validateDecisions(value, validKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('用途清单格式不正确。');
  const result = {};
  for (const [key, decision] of Object.entries(value)) {
    if (!validKeys.has(key)) throw new Error(`素材库里没有这个动作：${key}`);
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) throw new Error('动作记录格式不正确。');
    const scenarios = decision.scenarios ?? [];
    if (!Array.isArray(scenarios) || scenarios.some(s => !SCENARIOS.includes(s))) throw new Error('用途分类不正确。');
    if (decision.favorite !== undefined && typeof decision.favorite !== 'boolean') throw new Error('收藏标记不正确。');
    if (decision.note !== undefined && (typeof decision.note !== 'string' || decision.note.length > 2000)) throw new Error('备注最长 2000 字。');
    result[key] = { favorite: Boolean(decision.favorite), scenarios: [...new Set(scenarios)], note: decision.note || '' };
  }
  return result;
}
