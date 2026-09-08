import { AMBIENT_GLSL, AmbientTimeline, resolveMotion, motionId, isFineDither, sampleAmbient, printGrain } from './ambient-motion';
import type { AsciiFrame, AsciiOptions } from '../types';
import { INK_TRAIL_GLSL, isDensityHover } from './ink-trail';
import { createTrailGlyphs } from './trail-glyphs';
import { SURFACE_LIGHT_GLSL, type SurfaceRefraction } from './water-surface';

/** A cached artwork surface. Pointer-only frames never redraw or read back glyphs. */
export function createSurfaceRenderer(host: HTMLElement, source: HTMLCanvasElement, wake: () => void) {
  const originalVisibility = source.style.visibility;
  let canvas = document.createElement('canvas');
  let gl: WebGLRenderingContext | null = null, ctx: CanvasRenderingContext2D | null = null;
  let program: WebGLProgram | null = null, buffer: WebGLBuffer | null = null;
  const textures: WebGLTexture[] = [], shaders: WebGLShader[] = [];
  let disposed = false, uploaded = false, textureLimit = 4096;
  const bright = document.createElement('canvas'), lightLayer = document.createElement('canvas');
  const brightCtx = bright.getContext('2d')!, lightCtx = lightLayer.getContext('2d')!;
  let brightReady = false;
  const timeline = new AmbientTimeline();
  const glyphs=createTrailGlyphs();
  let glyphData: ReturnType<typeof glyphs.update>|null=null;
  let locations: Record<string, WebGLUniformLocation | null> = {};
  const attach = () => {
    canvas.className = 'ascii-hover-surface';
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'ASCII artwork preview');
    canvas.dataset.renderer = gl ? 'surface-gpu' : 'surface-canvas';
    host.prepend(canvas); source.style.visibility = 'hidden';
  };
  const release = () => {
    if (!gl) return;
    textures.forEach(t => gl!.deleteTexture(t)); shaders.forEach(s => gl!.deleteShader(s));
    if (program) gl.deleteProgram(program); if (buffer) gl.deleteBuffer(buffer);
  };
  const fallback = () => {
    if (disposed || ctx) return;
    canvas.removeEventListener('webglcontextlost', fallback);
    release(); canvas.remove(); gl = null;
    canvas = document.createElement('canvas'); ctx = canvas.getContext('2d'); attach(); wake();
  };
  try {
    gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL unavailable');
    textureLimit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const compile = (type: number, code: string) => {
      const shader = gl!.createShader(type)!; shaders.push(shader);
      gl!.shaderSource(shader, code); gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(shader) || 'Shader compilation failed');
      return shader;
    };
    program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, 'attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}'));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `
      precision highp float;
      uniform sampler2D artwork; uniform sampler2D surface;
      uniform vec2 resolution; uniform vec2 sceneSize; uniform vec2 cellSize;
      uniform vec2 surfaceSize; uniform float strength;
      ${SURFACE_LIGHT_GLSL}
      uniform sampler2D codes; uniform sampler2D cellColors; uniform sampler2D glyphAtlas;
      uniform vec2 gridSize; uniform vec2 atlasSize; uniform vec2 tileSize;
      uniform float atlasColumns; uniform float padding; uniform float glyphCount;
      uniform float dots; uniform float dotSize;
      ${INK_TRAIL_GLSL}
      ${AMBIENT_GLSL}
      float toneAt(vec2 uv) {
        vec2 p=uv*gridSize-.5, b=floor(p), f=fract(p);
        return mix(mix(texture2D(codes,(b+.5)/gridSize).b,texture2D(codes,(b+vec2(1.5,.5))/gridSize).b,f.x),mix(texture2D(codes,(b+vec2(.5,1.5))/gridSize).b,texture2D(codes,(b+1.5)/gridSize).b,f.x),f.y);
      }
      void main(){
        vec2 uv = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y) / resolution;
        vec2 pixel = uv * sceneSize;
        if (strength > 0.) {
          vec4 normal = texture2D(surface, (uv * (surfaceSize - 1.) + .5) / surfaceSize) * 255.;
          vec2 slope = (vec2(normal.r * 256. + normal.g, normal.b * 256. + normal.a) - 32768.) / 32767.;
          vec2 edge = min(pixel, sceneSize - pixel) / cellSize;
          uv -= slope * strength * smoothstep(2.,8.,min(edge.x,edge.y)) / sceneSize;
        }
        vec4 ambient=ambientAt(uv);
        uv -= ambient.xy/sceneSize;
        pixel=uv*sceneSize;
        vec4 ink = texture2D(artwork, uv);
        if (fineDither > .5) {
          vec2 cell=floor(pixel/cellSize),address=(cell+.5)/gridSize;
          vec4 color=texture2D(cellColors,address);
          float density=trailAmount>0.?trailDensity(address):0.;
          float tone=clamp(toneAt(uv)+ambient.z+(trailKind>1.5?-density:density)*.65,0.,1.);
          float pitch=max(1.,min(cellSize.x,cellSize.y)*.32);
          float grain=.5+(printGrain(floor(pixel/pitch))-.5)*ditherAmount;
          float alpha=(tone<.001?0.:tone>.999?1.:smoothstep(grain-.035,grain+.035,tone))*color.a*ambient.w;
          // Preserve hue; tone is carried by mark coverage rather than muddy ink.
          vec3 hue=color.rgb/max(.001,max(color.r,max(color.g,color.b)));
          gl_FragColor=vec4(hue*alpha,alpha); return;
        }
        if (trailAmount > 0. || motionMode > .5) {
          vec2 cell=floor(pixel/cellSize), address=(cell+.5)/gridSize;
          float density=trailAmount>0.?trailDensity(address):0.;
          vec4 encoded=texture2D(codes,address);
          float original=floor(encoded.r*255.+.5)+floor(encoded.g*255.+.5)*256.;
          float index=trailIndex(original,glyphCount,density,cell);
          if(original>.5) index=clamp(floor(index+ambient.z*(glyphCount-1.)+printGrain(cell)),0.,glyphCount-1.);
          vec4 color=texture2D(cellColors,address);
          if((index!=original || motionMode>.5) && color.a>.01) {
            vec2 local=(pixel-cell*cellSize)*resolution/sceneSize;
            vec2 slot=vec2(mod(index,atlasColumns),floor(index/atlasColumns));
            float alpha=texture2D(glyphAtlas,(slot*tileSize+padding+local)/atlasSize).a;
            if(dots>.5) {
              vec2 d=(pixel-(cell+.5)*cellSize)/min(cellSize.x,cellSize.y);
              float r=min(.48,(index/(glyphCount-1.))*.5*dotSize);
              alpha=1.-smoothstep(r-.06,r+.02,length(d));
            }
            // Replace the cell, rather than blending two glyphs into a ghost.
            vec3 rgb=trailInk(color.rgb,density);
            ink=vec4(rgb*alpha*color.a,alpha*color.a);
          }
        }
        vec3 straightInk = ink.a > .0 ? ink.rgb / ink.a : vec3(.0);
        float value = max(straightInk.r, max(straightInk.g, straightInk.b));
        // Lighting belongs to character ink; black/transparent gaps stay empty.
        float light = surfaceLight((floor(pixel / cellSize) + .5) * cellSize / sceneSize, sceneSize);
        vec3 lit = illuminate(straightInk, light * smoothstep(0., .22, value)) * ink.a;
        gl_FragColor = vec4(lit, ink.a)*ambient.w;
      }`));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Surface shader link failed');
    gl.useProgram(program);
    buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    locations = Object.fromEntries(['artwork','surface','resolution','sceneSize','cellSize','surfaceSize','strength','hoverMode','hoverFocus','codes','cellColors','glyphAtlas','gridSize','atlasSize','tileSize','atlasColumns','padding','glyphCount','dots','dotSize','trailKind', 'trailAmount', 'motionMode', 'motionTime', 'fineDither', 'ditherAmount'].map(k => [k,gl!.getUniformLocation(program!,k)]));
    for (let unit=0; unit<5; unit++) {
      const texture=gl.createTexture()!; textures.push(texture); gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    }
    gl.uniform1i(locations.codes,2); gl.uniform1i(locations.cellColors,3); gl.uniform1i(locations.glyphAtlas,4);
    gl.uniform1i(locations.artwork,0); gl.uniform1i(locations.surface,1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    canvas.addEventListener('webglcontextlost', fallback); attach();
  } catch { fallback(); }
  return {
    get canvas() { return canvas; },
    render(dirty: boolean, field: SurfaceRefraction, width: number, height: number, cellWidth: number, cellHeight: number, frame?: AsciiFrame, options?: AsciiOptions, time = 0) {
      const mode=resolveMotion(options?.animationStyle), phase=timeline.update(time,mode,options?.animationSpeed);
      const dither=isFineDither(options);
      if (disposed || !width || !height || !source.width || !source.height) return;
      const ratio = Math.min(source.width / width, 1.5, Math.sqrt(4_000_000 / (width * height)));
      const w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio));
      if (canvas.width !== w || canvas.height !== h) { canvas.width=w; canvas.height=h; uploaded=false; }
      if (gl && (source.width > textureLimit || source.height > textureLimit)) fallback();
      if ((isDensityHover(field.mode) || mode !== 'none' || dither) && (dirty || !uploaded || !glyphData)) {
        glyphData=glyphs.update(source,width,height,cellWidth,cellHeight,ratio,frame,options);
        if(gl) {
          const {plan,packed,atlas}=glyphData;
          for(const [unit,data] of [[2,packed.indices],[3,packed.colors]] as const) {
            gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,textures[unit]);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
            gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,packed.cols,packed.rows,0,gl.RGBA,gl.UNSIGNED_BYTE,data);
          }
          gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D,textures[4]); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,atlas);
          gl.uniform2f(locations.gridSize,packed.cols,packed.rows); gl.uniform2f(locations.atlasSize,plan.atlasWidth,plan.atlasHeight);
          gl.uniform2f(locations.tileSize,plan.tileWidth,plan.tileHeight); gl.uniform1f(locations.atlasColumns,plan.atlasColumns);
          gl.uniform1f(locations.padding,plan.padding); gl.uniform1f(locations.glyphCount,plan.glyphs.length);
          gl.uniform1f(locations.dots,glyphData.dots?1:0); gl.uniform1f(locations.dotSize,glyphData.dotSize);
        }
      }
      if (gl) {
        gl.uniform1f(locations.motionMode,motionId(mode)); gl.uniform1f(locations.motionTime,phase); gl.uniform1f(locations.fineDither,dither?1:0); gl.uniform1f(locations.ditherAmount,Math.max(0,Math.min(2,options?.ditherStrength ?? 1)));
        gl.uniform1f(locations.trailKind,field.mode==='dissolve'?2:0);
        gl.uniform1f(locations.trailAmount,isDensityHover(field.mode)?field.focus[2]:0);
        gl.viewport(0,0,w,h);
        if (dirty || !uploaded) {
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,textures[0]);
          // Artwork is premultiplied for compositing; encoded field/index data is not.
          // In particular, density textures deliberately store zero in alpha.
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false); uploaded=true;
        }
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,textures[1]);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,field.width,field.height,0,gl.RGBA,gl.UNSIGNED_BYTE,field.pixels);
        gl.uniform2f(locations.resolution,w,h); gl.uniform2f(locations.sceneSize,width,height);
        gl.uniform2f(locations.cellSize,cellWidth,cellHeight); gl.uniform2f(locations.surfaceSize,field.width,field.height);
        gl.uniform1f(locations.strength,field.strength);
        gl.uniform1f(locations.hoverMode,field.mode==='light'?1:field.mode==='scan'?2:0); gl.uniform4fv(locations.hoverFocus,field.focus);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      } else if (ctx) {
        ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,width,height);
        ctx.drawImage(source,0,0,width,height);
        if((mode !== 'none' || dither) && glyphData) {
          ctx.clearRect(0,0,width,height);
          const {plan,packed,atlas}=glyphData, a=[0,0,0,1];
          const pitch=Math.max(1,Math.min(cellWidth,cellHeight)*.32);
          for(let y=0;y<packed.rows;y++)for(let x=0;x<packed.cols;x++) {
            const u=(x+.5)/packed.cols,v=(y+.5)/packed.rows,i=(y*packed.cols+x)*4;
            if(packed.colors[i+3]<10)continue;
            sampleAmbient(mode,u,v,phase,a);
            const fi=(Math.min(field.height-1,Math.round(v*(field.height-1)))*field.width+Math.min(field.width-1,Math.round(u*(field.width-1))))*4;
            const density=isDensityHover(field.mode)?(field.pixels[fi]*256+field.pixels[fi+1])/65535*field.focus[2]:0;
            const original=packed.indices[i]+packed.indices[i+1]*256;
            let index=field.mode==='dissolve'?original-Math.floor(density*plan.glyphs.length*1.8):original+Math.floor(density*plan.glyphs.length*.85);
            if(original>0)index+=a[2]*(plan.glyphs.length-1);
            index=Math.max(0,Math.min(plan.glyphs.length-1,Math.floor(index+printGrain(x,y))));
            let dx=a[0],dy=a[1];
            if(field.strength>0) { dx+=(field.pixels[fi]*256+field.pixels[fi+1]-32768)/32767*field.strength; dy+=(field.pixels[fi+2]*256+field.pixels[fi+3]-32768)/32767*field.strength; }
            const px=x*cellWidth+dx,py=y*cellHeight+dy,alpha=packed.colors[i+3]/255*a[3];
            const peak=dither?Math.max(1,packed.colors[i],packed.colors[i+1],packed.colors[i+2]):255;
            const color=`rgb(${packed.colors[i]/peak*255},${packed.colors[i+1]/peak*255},${packed.colors[i+2]/peak*255})`;
            ctx.fillStyle=color;
            if(dither) {
              const tone=Math.max(0,Math.min(1,packed.indices[i+2]/255+a[2]+(field.mode==='dissolve'?-density:density)*.65));
              ctx.globalAlpha=alpha;
              for(let oy=0;oy<cellHeight;oy+=pitch)for(let ox=0;ox<cellWidth;ox+=pitch)
                if(tone>.5+(printGrain(Math.floor((px+ox)/pitch),Math.floor((py+oy)/pitch))-.5)*Math.max(0,Math.min(2,options?.ditherStrength??1)))ctx.fillRect(px+ox,py+oy,Math.min(pitch,cellWidth-ox),Math.min(pitch,cellHeight-oy));
            } else if(index>0) {
              ctx.globalAlpha=alpha;
              if(glyphData.dots) { const r=Math.min(.48,index/(plan.glyphs.length-1)*.5*glyphData.dotSize)*Math.min(cellWidth,cellHeight);ctx.beginPath();ctx.arc(px+cellWidth*.5,py+cellHeight*.5,r,0,Math.PI*2);ctx.fill(); }
              else {
                ctx.drawImage(atlas,(index%plan.atlasColumns)*plan.tileWidth+plan.padding,Math.floor(index/plan.atlasColumns)*plan.tileHeight+plan.padding,plan.cellWidth*ratio,plan.cellHeight*ratio,px,py,cellWidth,cellHeight);
                ctx.globalAlpha=1;ctx.globalCompositeOperation='source-atop';ctx.fillRect(px,py,cellWidth,cellHeight);ctx.globalCompositeOperation='source-over';
              }
            }
          }
          ctx.globalAlpha=1;
        } else if(isDensityHover(field.mode) && glyphData) {
          const {plan,packed,atlas}=glyphData;
          for(let y=0;y<packed.rows;y++) for(let x=0;x<packed.cols;x++) {
            const fi=(Math.min(field.height-1,Math.round((y+.5)/packed.rows*(field.height-1)))*field.width+Math.min(field.width-1,Math.round((x+.5)/packed.cols*(field.width-1))))*4;
            const density=(field.pixels[fi]*256+field.pixels[fi+1])/65535*field.focus[2],i=(y*packed.cols+x)*4;
            const seed=(x*x*17+y*y*23+x*y*19)*.0137,grain=seed-Math.floor(seed);
            const original=packed.indices[i]+packed.indices[i+1]*256,index=field.mode==='dissolve'?Math.max(0,original-Math.floor(density*plan.glyphs.length*(1.35+grain*.9))):Math.min(plan.glyphs.length-1,original+Math.floor(density*plan.glyphs.length*.85));
            if(index===original || packed.colors[i+3]<10) continue;
            const px=x*cellWidth,py=y*cellHeight;
            ctx.clearRect(px,py,cellWidth,cellHeight);
            ctx.globalAlpha=packed.colors[i+3]/255;
            if(glyphData.dots) {
              const r=Math.min(.48,index/(plan.glyphs.length-1)*.5*glyphData.dotSize)*Math.min(cellWidth,cellHeight);
              ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(px+cellWidth*.5,py+cellHeight*.5,r,0,Math.PI*2); ctx.fill();
            } else ctx.drawImage(atlas,(index%plan.atlasColumns)*plan.tileWidth+plan.padding,Math.floor(index/plan.atlasColumns)*plan.tileHeight+plan.padding,plan.cellWidth*ratio,plan.cellHeight*ratio,px,py,cellWidth,cellHeight);
            ctx.globalAlpha=1;
            ctx.globalCompositeOperation='source-atop';
            const peak=Math.max(packed.colors[i],packed.colors[i+1],packed.colors[i+2]), raised=field.mode==='dissolve'?peak:Math.max(peak,Math.min(112,density*191)), gain=peak?raised/peak:0;
            ctx.fillStyle=`rgb(${peak?packed.colors[i]*gain:raised},${peak?packed.colors[i+1]*gain:raised},${peak?packed.colors[i+2]*gain:raised})`;
            ctx.fillRect(px,py,cellWidth,cellHeight); ctx.globalCompositeOperation='source-over';
          }
        } else if (field.mode === 'light' || field.mode === 'scan') {
          // Cache the brighter ink once per source frame. One masked composite
          // per pointer frame, rather than hundreds of filtered tile draws.
          if (dirty || !brightReady || bright.width !== w || bright.height !== h) {
            bright.width=w; bright.height=h; lightLayer.width=w; lightLayer.height=h;
            brightCtx.filter='brightness(3)'; brightCtx.drawImage(source,0,0,w,h); brightCtx.filter='none'; brightReady=true;
          }
          const [cx,cy,amount,radius]=field.focus;
          if (amount > .001) {
            lightCtx.setTransform(1,0,0,1,0,0); lightCtx.clearRect(0,0,w,h); lightCtx.drawImage(bright,0,0);
            lightCtx.globalCompositeOperation='destination-in';
            lightCtx.save(); lightCtx.translate(cx*w,cy*h); lightCtx.scale(field.mode==='scan'?.13:1,1);
            const r=radius*Math.min(w,h), gradient=lightCtx.createRadialGradient(0,0,0,0,0,r);
            gradient.addColorStop(0,`rgba(255,255,255,${amount})`); gradient.addColorStop(.5,`rgba(255,255,255,${amount*.4})`); gradient.addColorStop(1,'rgba(255,255,255,0)');
            lightCtx.fillStyle=gradient; lightCtx.fillRect(-w*10,-h*10,w*20,h*20); lightCtx.restore(); lightCtx.globalCompositeOperation='source-over';
            ctx.globalCompositeOperation='source-atop'; ctx.drawImage(lightLayer,0,0,width,height); ctx.globalCompositeOperation='source-over';
          }
        } else if (field.strength > 0) {
          const columns=32, rows=18, tw=width/columns, th=height/rows;
          for(let y=0;y<rows;y++) for(let x=0;x<columns;x++) {
            const u=(x+.5)/columns,v=(y+.5)/rows;
            const ix=Math.min(field.width-1,Math.round(u*(field.width-1))),iy=Math.min(field.height-1,Math.round(v*(field.height-1)));
            const i=(iy*field.width+ix)*4,p=field.pixels;
            const edge=Math.min(x*tw/cellWidth,(width-(x+1)*tw)/cellWidth,y*th/cellHeight,(height-(y+1)*th)/cellHeight);
            const t=Math.max(0,Math.min(1,(edge-2)/6)), hold=t*t*(3-2*t);
            const dx=((p[i]*256+p[i+1]-32768)/32767)*field.strength*hold;
            const dy=((p[i+2]*256+p[i+3]-32768)/32767)*field.strength*hold;
            if(Math.abs(dx)+Math.abs(dy)<.02)continue;
            ctx.clearRect(x*tw,y*th,tw,th);
            ctx.drawImage(source,Math.max(0,Math.min(width-tw,x*tw-dx))*source.width/width,Math.max(0,Math.min(height-th,y*th-dy))*source.height/height,tw*source.width/width,th*source.height/height,x*tw,y*th,tw,th);
          }
        }
      }
    },
    destroy() {
      disposed=true; glyphs.destroy(); canvas.removeEventListener('webglcontextlost',fallback); release();
      canvas.remove(); bright.width=bright.height=lightLayer.width=lightLayer.height=1; source.style.visibility=originalVisibility; gl?.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
