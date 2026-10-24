// All eight faces are cells of the exported 2 × 4 EyeTex atlas.
// Personality changes the neutral face; animation curves still own blinks and reactions.
export const EYES = Object.freeze([
  { id: 'default', index: 0, label: '默认', group: '性格眼神' },
  { id: 'cheerful', index: 1, label: '开朗 / 天真 · 微笑', group: '性格眼神' },
  { id: 'sleepy', index: 5, label: '懒散 / 悠闲 · 困倦', group: '性格眼神' },
  { id: 'timid', index: 6, label: '胆小 · 哭哭', group: '性格眼神' },
  { id: 'hasty', index: 3, label: '急躁 · 生气', group: '性格眼神' },
  { id: 'shocked', index: 2, label: '震惊', group: '其他眼神' },
  { id: 'closed', index: 4, label: '闭眼', group: '其他眼神' },
  { id: 'dizzy', index: 7, label: '眩晕', group: '其他眼神' },
]);

export function eyeIndex(eye, curve = [], time = 0, auto = true) {
  const base = EYES.find(option => option.id === eye)?.index ?? 0;
  if (!auto) return base;
  let value = 100;
  for (const [at, face] of curve) { if (at > time) break; value = face; }
  const index = Number.isFinite(value) ? Math.min(7, Math.max(0, Math.round(value / 100) - 1)) : 0;
  return index === 0 ? base : index;
}
