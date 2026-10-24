const { deflateSync } = require('node:zlib');
function crc32(bytes) { let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0; }
function chunk(name, bytes) { const kind=Buffer.from(name), length=Buffer.alloc(4), sum=Buffer.alloc(4);length.writeUInt32BE(bytes.length);sum.writeUInt32BE(crc32(Buffer.concat([kind,bytes])));return Buffer.concat([length,kind,bytes,sum]); }
// A small, original leaf icon keeps an imported character render optional.
function leafPNG() {
  const size=32, pixels=Buffer.alloc(size*(1+size*4));
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=(x-16)/12,v=(y-16)/9, inside=u*u+v*v<1&&Math.abs(x+y-32)<18, at=y*(1+size*4)+1+x*4;
    const vein=Math.abs(y-x)<1.6;pixels.set(vein?[205,223,159,inside?255:0]:[101,139,65,inside?255:0],at);
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
module.exports={leafPNG};
