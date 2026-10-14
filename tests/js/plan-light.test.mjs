import test from 'node:test';
import assert from 'node:assert/strict';
import { lightState, windowReach } from '../../dashboard/js/plan/light.js';
test('unknown orientation never turns on analytical direct sunlight',()=>{
  for(const bearing of [null,undefined,NaN])assert.equal(lightState({bearing,altitude:45}).directional,false);
  assert.equal(lightState({bearing:0,altitude:45}).directional,true);
});
test('direct sun toggle and ambient preview are independent',()=>{
  const s=lightState({bearing:180,altitude:45,directSun:false,ambient:1.5});
  assert.equal(s.directional,false);assert.equal(s.ambient,1.5);assert.equal(s.day,true);
  assert.equal(lightState({bearing:180,altitude:-5}).directional,false);
  assert.equal(lightState({bearing:180,altitude:45,blocked:true}).directional,false);
});
test('unoccluded reach has correct geometric limit and unknowns',()=>{
  const inputs={bearing:180,sunAzimuth:180,altitude:45,head:96,orientationKnown:true};
  assert.ok(Math.abs(windowReach(inputs).inches-96)<1e-8);
  assert.equal(windowReach({...inputs,orientationKnown:false}).inches,null);
  assert.equal(windowReach({...inputs,sunAzimuth:0}).state,'behind');
  assert.equal(windowReach({...inputs,blocked:true}).state,'site-blocked');
  assert.equal(windowReach({...inputs,altitude:0}).state,'night');
});
import { glazingScale, roomDaylight, BLINDS, clampGlazing, blindsOf } from '../../dashboard/js/plan/light.js';
import { normalisePlan } from '../../dashboard/js/plan/model.js';
test('glass and blinds scale the sun patches relative to default glazing with open blinds', () => {
  assert.equal(glazingScale().sun, 1);
  assert.ok(Math.abs(glazingScale({ transmittance: 0.3 }).sun - 0.5) < 1e-12);
  assert.ok(Math.abs(glazingScale({ blinds: 'half' }).sun - 0.5) < 1e-12);
  assert.ok(Math.abs(glazingScale({ blinds: 'closed' }).sun - BLINDS.closed) < 1e-12);
  assert.equal(glazingScale({ transmittance: 1 }).sun, 1 / 0.6);
  assert.equal(clampGlazing(7), 1); assert.equal(clampGlazing(-1), 0.05); assert.equal(clampGlazing('x'), 0.6);
  assert.equal(blindsOf('weird'), 'open');
});
test('room daylight factor estimate follows the BRE formula with the plan sizes', () => {
  // a 12 x 16 ft room, 9 ft ceiling, one 6 ft window from 2 ft to 7 ft
  const m = normalisePlan({ schema: 1, id: 'df', units: 'in', ceiling: 108, rooms: [{ name: 'Living', kind: 'living', x: 0, y: 0, w: 144, h: 192 }],
    windows: [{ room: 'Living', x1: 36, y1: 192, x2: 108, y2: 192, sill: 24, head: 84 }] });
  const r = roomDaylight(m, [1]);
  assert.equal(r.length, 1);
  const M = 0.0254, aw = 72 * 60 * M * M * 0.8, A = 2 * 144 * 192 * M * M + 2 * (144 + 192) * M * 108 * M;
  assert.ok(Math.abs(r[0].df - (0.6 * aw * 90) / (A * 0.75)) < 1e-9, `${r[0].df}`);
  assert.ok(Math.abs(roomDaylight(m, [0.5])[0].df - r[0].df / 2) < 1e-9, 'linear in sky view');
  assert.ok(Math.abs(roomDaylight(m, [1], { blinds: 'half' })[0].df - r[0].df / 2) < 1e-9, 'blinds scale it');
  assert.ok(Math.abs(roomDaylight(m, [1], { transmittance: 0.3 })[0].df - r[0].df / 2) < 1e-9, 'glazing scales it');
  assert.deepEqual(roomDaylight(m, [null]), [], 'unknown sky view: no estimate');
});
