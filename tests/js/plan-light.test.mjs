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
