/** Bilinear, premultiplied-alpha sampling with a fast path for the resting grid. */
export function samplePixel(pixels: Uint8ClampedArray, cols: number, rows: number, x: number, y: number, out: number[]) {
  x=Math.max(0,Math.min(cols-1,x));y=Math.max(0,Math.min(rows-1,y));
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  const a=(iy*cols+ix)*4;
  if(fx===0&&fy===0){for(let c=0;c<4;c++)out[c]=pixels[a+c];return;}
  const b=(iy*cols+Math.min(cols-1,ix+1))*4;
  const c=(Math.min(rows-1,iy+1)*cols+ix)*4;
  const d=(Math.min(rows-1,iy+1)*cols+Math.min(cols-1,ix+1))*4;
  const wa=(1-fx)*(1-fy)*pixels[a+3],wb=fx*(1-fy)*pixels[b+3];
  const wc=(1-fx)*fy*pixels[c+3],wd=fx*fy*pixels[d+3],alpha=wa+wb+wc+wd;
  for(let channel=0;channel<3;channel++)out[channel]=alpha
    ?(pixels[a+channel]*wa+pixels[b+channel]*wb+pixels[c+channel]*wc+pixels[d+channel]*wd)/alpha:0;
  out[3]=alpha;
}
