// The player's own body, seen in the third-person camera: a wanderer in a teal
// tunic with a red scarf, a leather backpack and travel boots. Original design.

import { BACK, FRONT, bands, build, eye, faces, fur, px, tone, withFace, type MobModel, type PartSpec } from './models';

export function createAvatar(): MobModel {
  const skinC = '#d8a987';
  const skin = tone(skinC, { noise: 0.03 });
  const hairC = '#5a3a22';
  const face = withFace(skin, (g, w) => {
    px(g, '#3e2616', 1, 2, 2, 1); px(g, '#3e2616', w - 3, 2, 2, 1);        // brows
    eye(g, 1, 3, '#3a6a8a', 'r'); eye(g, w - 3, 3, '#3a6a8a', 'l');
    px(g, 'rgba(200,80,70,0.3)', 0, 5, 2, 1); px(g, 'rgba(200,80,70,0.3)', w - 2, 5, 2, 1);
    px(g, '#7a3a2a', 3, 6, 2, 1);
  });
  const tunic = faces(tone('#2f7a78', { top: '#3a8a86', bottom: '#256664' }), {
    [FRONT]: (g, w, h) => { px(g, '#1f5654', Math.floor(w / 2), 1, 1, h - 5); px(g, '#6a4428', 0, h - 4, w, 1); px(g, '#d8b048', Math.floor(w / 2) - 1, h - 4, 2, 1); },
    [BACK]: (g, w, h) => px(g, '#6a4428', 0, h - 4, w, 1),
  });
  const sleeve = bands([['#2f7a78', 7], ['#256664', 1], [skinC, 3]]);
  const legs = bands([['#b89a6a', 7], ['#3a2a1e', 1], ['#4a3222', 3]]);
  const hair = fur(hairC, { strand: 0.25 });
  const scarf = tone('#b8342a', { top: '#c8443a' });
  const leather = tone('#7a4a2a', { top: '#8a5a34', bottom: '#5a3620' });
  const parts: PartSpec[] = [
    { name: 'legL', size: [4, 12, 4], pivot: [-2, 12, 0], offset: [0, -6, 0], paint: legs, extra: [{ size: [4.4, 2, 5], offset: [0, -11, -0.5], paint: tone('#3a2618') }] },
    { name: 'legR', size: [4, 12, 4], pivot: [2, 12, 0], offset: [0, -6, 0], paint: legs, extra: [{ size: [4.4, 2, 5], offset: [0, -11, -0.5], paint: tone('#3a2618') }] },
    { name: 'torso', size: [8, 12, 4], pivot: [0, 12, 0], offset: [0, 6, 0], paint: tunic },
    { name: 'scarf', size: [8.6, 2.2, 4.6], pivot: [0, 23, 0], offset: [0, 0, 0], paint: scarf, parent: 'torso', extra: [{ size: [2, 5, 1], offset: [2, -3, 2.6], paint: scarf, rot: [0.25, 0, 0.1] }] },
    { name: 'pack', size: [6, 8, 3], pivot: [0, 21, 2], offset: [0, -4, 1.5], paint: faces(leather, { [BACK]: (g, w) => { px(g, '#5a3620', 0, 2, w, 1); px(g, '#c8a048', Math.floor(w / 2), 2); } }), parent: 'torso', extra: [{ size: [6.4, 1.6, 3.4], offset: [0, 4.4, 1.5], paint: tone('#8a5a34') }] },
    { name: 'head', size: [8, 8, 8], pivot: [0, 24, 0], offset: [0, 4, 0], paint: face, parent: 'torso' },
    { name: 'hair', size: [8.6, 2.4, 8.6], pivot: [0, 32, 0], offset: [0, -0.6, 0.2], paint: hair, parent: 'head', extra: [{ size: [8.4, 6, 1], offset: [0, -3.8, 4.1], paint: hair }, { size: [3, 2, 1], offset: [-2.5, -2.2, -4.1], paint: hair }] },
    { name: 'armL', size: [4, 12, 4], pivot: [-6, 22, 0], offset: [0, -5, 0], paint: sleeve, parent: 'torso' },
    { name: 'armR', size: [4, 12, 4], pivot: [6, 22, 0], offset: [0, -5, 0], paint: sleeve, parent: 'torso' },
  ];
  return build('avatar', parts, 0.9);
}
