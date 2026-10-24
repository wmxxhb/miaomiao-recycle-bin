const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function overlap(a,b){return a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;}

// All coordinates here are Electron DIP coordinates. Native movement converts once to pixels.
function dialogueLayout(pet,work,sizes={},anchors={}){
  const area={x:work.x+8,y:work.y+8,width:Math.max(120,work.width-16),height:Math.max(100,work.height-16)};
  const head={x:pet.x+(anchors.head?.x??pet.width*.5),y:pet.y+(anchors.head?.y??pet.height*.2)};
  const feet={x:pet.x+(anchors.feet?.x??pet.width*.5),y:pet.y+(anchors.feet?.y??pet.height*.84)};
  const width=Math.round(Math.min(400,area.width)),height=Math.round(clamp(sizes.bubble||108,88,Math.min(340,area.height)));
  const centeredX=clamp(Math.round(head.x-width/2),area.x,area.x+area.width-width);
  const centeredY=clamp(Math.round(head.y-height*.55),area.y,area.y+area.height-height);
  let bubble;
  if(head.y-12-height>=area.y)bubble={x:centeredX,y:Math.round(head.y-12-height),tailSide:'bottom'};
  else if(pet.x+pet.width+width<=area.x+area.width)bubble={x:Math.round(pet.x+pet.width-8),y:centeredY,tailSide:'left'};
  else if(pet.x-width>=area.x)bubble={x:Math.round(pet.x-width+8),y:centeredY,tailSide:'right'};
  else if(feet.y+height+12<=area.y+area.height)bubble={x:centeredX,y:Math.round(feet.y+12),tailSide:'top'};
  else bubble={x:centeredX,y:area.y,tailSide:'bottom'};
  bubble={...bubble,width,height};
  bubble.x=clamp(bubble.x,area.x,area.x+area.width-width);bubble.y=clamp(bubble.y,area.y,area.y+area.height-height);
  const vertical=['top','bottom'].includes(bubble.tailSide);
  bubble.tailOffset=Math.round(clamp(vertical?head.x-bubble.x:head.y-bubble.y,38,(vertical?width:height)-38));
  const inputWidth=Math.round(Math.min(380,area.width)),inputHeight=Math.round(clamp(sizes.input||146,110,Math.min(220,area.height)));
  let input={x:clamp(Math.round(feet.x-inputWidth/2),area.x,area.x+area.width-inputWidth),y:clamp(Math.round(feet.y+10),area.y,area.y+area.height-inputHeight),width:inputWidth,height:inputHeight};
  if(overlap(input,bubble)){
    const candidates=[{...input,y:bubble.y+bubble.height+8},{...input,y:bubble.y-inputHeight-8},
      {...input,x:bubble.x-inputWidth-8},{...input,x:bubble.x+bubble.width+8}];
    const fit=candidates.find(p=>p.x>=area.x&&p.y>=area.y&&p.x+p.width<=area.x+area.width&&p.y+p.height<=area.y+area.height&&!overlap(p,bubble));
    if(fit)input=fit;
  }
  return {bubble,input,limits:{width,maxTextHeight:Math.max(64,Math.min(240,area.height-100)),inputWidth}};
}
module.exports={dialogueLayout,overlap};
