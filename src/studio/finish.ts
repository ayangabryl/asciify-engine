import type { StudioSettings } from "./model";
/** One optional GPU pass. The source is never read back from the GPU. */
export function createStudioFinish() {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;
  const shaders: WebGLShader[] = [];
  const compile = (type: number, code: string) => {
    const s = gl.createShader(type)!;
    shaders.push(s);
    gl.shaderSource(s, code);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) || "Finish shader failed");
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(
    p,
    compile(
      gl.VERTEX_SHADER,
      "attribute vec2 p;varying vec2 uv;void main(){uv=(p+1.)*.5;gl_Position=vec4(p,0.,1.);}",
    ),
  );
  gl.attachShader(
    p,
    compile(
      gl.FRAGMENT_SHADER,
      `precision mediump float;varying vec2 uv;uniform sampler2D src;uniform vec2 size;uniform float t,bloom,grain,dust,scanlines,crt,prism,vignette,glitch,pixelate,blur,blurMode,angle,focus,halftone;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 vec4 sampleAt(vec2 p){if(min(min(p.x,p.y),min(1.-p.x,1.-p.y))<0.)return vec4(0.);return texture2D(src,vec2(p.x,1.-p.y));}
 void main(){vec2 q=uv,c=q-.5;q=c*(1.+dot(c,c)*crt*.25)+.5;
 if(glitch>0.)q.x+=(hash(vec2(floor(q.y*35.),floor(t*5.)))-.5)*.07*glitch*step(.82,hash(vec2(floor(q.y*35.),floor(t*5.)+3.)));
 if(pixelate>0.){vec2 grid=size/(1.+pixelate*20.);q=(floor(q*grid)+.5)/grid;}
 vec4 base=sampleAt(q);float edge=smoothstep(.12,.65,length(c));
 vec2 shift=vec2(prism*3.*edge/size.x,prism*edge/size.y);
 if(prism>0.)base.rgb=vec3(sampleAt(q+shift).r,base.g,sampleAt(q-shift).b);
 vec2 dir=vec2(cos(angle),sin(angle))/size;float amount=blur;
 if(blurMode>1.5&&blurMode<2.5){dir=normalize(c+vec2(.0001))/size;amount*=length(c)*2.;}
 if(blurMode>2.5)amount*=smoothstep(.05,.5,abs(q.y-focus));
 vec4 blurred=base;
 if(amount>0.){blurred=base*.2;for(int i=1;i<=4;i++){float f=float(i)*amount*.35;vec2 off=dir*f;if(blurMode<.5)off=vec2(cos(float(i)*1.57),sin(float(i)*1.57))*amount/size;blurred+=sampleAt(q+off)*.1+sampleAt(q-off)*.1;}}
 vec3 light=vec3(0.);if(bloom>0.)for(int i=0;i<4;i++){float a=float(i)*1.5708;vec3 s=sampleAt(q+vec2(cos(a),sin(a))*6./size).rgb;light+=max(vec3(0.),s-.35)*.25;}
 vec3 col=blurred.rgb+light*bloom;col*=1.-scanlines*.4*(.5+.5*cos(q.y*size.y*3.14159));
 col*=1.-vignette*smoothstep(.15,.72,length(c));
 col+=(hash(floor(q*size)+floor(t*12.))-.5)*grain*.2;
 if(dust>0.)col+=step(1.-dust*.002,hash(floor(q*size*.25)+floor(t*2.)))*.4;
 if(halftone>0.)col*=mix(1.,smoothstep(.1,.65,length(fract(q*size/6.)-.5)),halftone);
 gl_FragColor=vec4(clamp(col,0.,1.),blurred.a);}`,
    ),
  );
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error("Finish link failed");
  gl.useProgram(p);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const loc = gl.getAttribLocation(p, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const names = [
    "t",
    "bloom",
    "grain",
    "dust",
    "scanlines",
    "crt",
    "prism",
    "vignette",
    "glitch",
    "pixelate",
    "blur",
    "blurMode",
    "angle",
    "focus",
    "halftone",
  ];
  const uniforms = Object.fromEntries(
    names.map((n) => [n, gl.getUniformLocation(p, n)]),
  );
  const size = gl.getUniformLocation(p, "size");
  return {
    canvas,
    render(
      source: HTMLCanvasElement,
      e: StudioSettings["effects"],
      time: number,
      pixelRatio = 1,
    ) {
      if (canvas.width !== source.width || canvas.height !== source.height) {
        canvas.width = source.width;
        canvas.height = source.height;
        gl.viewport(0, 0, canvas.width, canvas.height);
      }
      gl.useProgram(p);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source,
      );
      gl.uniform2f(size, canvas.width / pixelRatio, canvas.height / pixelRatio);
      for (const name of names)
        gl.uniform1f(
          uniforms[name],
          name === "t"
            ? time
            : name === "blurMode"
              ? ["gaussian", "directional", "radial", "progressive"].indexOf(
                  e.blurType,
                )
              : name === "angle"
                ? (e.angle * Math.PI) / 180
                : ((e as unknown as Record<string, number>)[name] ?? 0),
        );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return canvas;
    },
    destroy() {
      gl.deleteTexture(tex);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(p);
      shaders.forEach((s) => gl.deleteShader(s));
      canvas.width = canvas.height = 1;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
