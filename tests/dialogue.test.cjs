const test=require('node:test');
const assert=require('node:assert/strict');
const {dialogueLayout,overlap}=require('../app/dialogue-layout.cjs');
function inside(r,work){assert.ok(r.x>=work.x&&r.y>=work.y&&r.x+r.width<=work.x+work.width&&r.y+r.height<=work.y+work.height,JSON.stringify({r,work}));}

test('full reply and input stay on the active display at all four corners and pet scales',()=>{
  for(const work of [{x:0,y:0,width:1920,height:1080},{x:-1280,y:-200,width:1280,height:720},{x:2000,y:0,width:800,height:600}]){
    for(const scale of [.5,1,2]){
      const width=Math.min(360*scale,work.width),height=Math.min(450*scale,work.height);
      for(const x of [work.x,work.x+work.width-width])for(const y of [work.y,work.y+work.height-height]){
        const result=dialogueLayout({x,y,width,height},work,{bubble:340,input:190});inside(result.bubble,work);inside(result.input,work);
      }
    }
  }
});
test('headroom places the comic bubble above the head, with a tail that follows the head after edge clamping',()=>{
  const work={x:0,y:0,width:1920,height:1080},pet={x:1530,y:600,width:360,height:450};
  const result=dialogueLayout(pet,work,{bubble:180},{head:{x:180,y:70},feet:{x:180,y:370}});
  assert.equal(result.bubble.tailSide,'bottom');assert.ok(result.bubble.y+result.bubble.height<pet.y+70);
  assert.equal(result.bubble.x+result.bubble.tailOffset,pet.x+180);
  assert.ok(!overlap(result.input,result.bubble));
});
test('a pet near the top moves its bubble to a free side',()=>{
  const work={x:0,y:0,width:1920,height:1080};
  const right=dialogueLayout({x:20,y:0,width:360,height:450},work,{bubble:300});
  const left=dialogueLayout({x:1540,y:0,width:360,height:450},work,{bubble:300});
  assert.equal(right.bubble.tailSide,'left');assert.equal(left.bubble.tailSide,'right');
});
test('large messages have bounded dimensions and leave room for scrolling',()=>{
  const work={x:-400,y:0,width:800,height:600},pet={x:-350,y:100,width:360,height:450};
  const result=dialogueLayout(pet,work,{bubble:64000,input:10000});
  assert.equal(result.bubble.height,340);assert.equal(result.input.height,220);assert.ok(result.limits.maxTextHeight<=240);
  inside(result.bubble,work);inside(result.input,work);
});
