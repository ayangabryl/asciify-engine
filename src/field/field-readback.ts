/**
 * Reads a small mip level of a texture back to the CPU without stalling: the pixels are copied into a pixel-pack buffer on
 * the GPU, and fetched a frame or more later, once a fence says the copy has finished. A playing video or live canvas uses it
 * for its levels and hover scope, which would otherwise wait on the GPU every time they were measured.
 */
export interface MipRead { data: Uint8Array; width: number; height: number }

/** The mip level whose longer side is at most `maxSide`, or level 0 when the texture is already that small. */
export function mipLevelFor(width: number, height: number, maxSide: number) {
  let level = 0;
  while (Math.max(width >> level, height >> level) > maxSide && (width >> (level + 1)) >= 1 && (height >> (level + 1)) >= 1) level++;
  return { level, width: Math.max(1, width >> level), height: Math.max(1, height >> level) };
}

export function createMipReader(gl: WebGL2RenderingContext) {
  let framebuffer: WebGLFramebuffer | null = null, buffer: WebGLBuffer | null = null, sync: WebGLSync | null = null;
  let size = 0, width = 0, height = 0, broken = false;
  return {
    /** Whether a read is waiting on the GPU. */
    get pending() { return !!sync; },
    /**
     * Starts copying `texture`'s mip level whose longer side is at most `maxSide`. Returns false when it cannot (a read is
     * already waiting, or the browser cannot read that level), so the caller can measure another way.
     */
    request(texture: WebGLTexture, sourceWidth: number, sourceHeight: number, maxSide: number): boolean {
      if (sync || broken || !sourceWidth || !sourceHeight) return false;
      const mip = mipLevelFor(sourceWidth, sourceHeight, maxSide);
      try {
        framebuffer ??= gl.createFramebuffer();
        buffer ??= gl.createBuffer();
        const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, mip.level);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
          broken = true;
          return false;
        }
        const bytes = mip.width * mip.height * 4;
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
        if (bytes !== size) { gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ); size = bytes; }
        gl.pixelStorei(gl.PACK_ALIGNMENT, 4);
        gl.readPixels(0, 0, mip.width, mip.height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
        sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        width = mip.width; height = mip.height;
        return !!sync;
      } catch {
        broken = true;
        return false;
      }
    },
    /** The pixels of the last request once the GPU has them (top row first, as the texture was uploaded), else null. */
    poll(): MipRead | null {
      if (!sync) return null;
      const state = gl.clientWaitSync(sync, 0, 0);
      if (state !== gl.ALREADY_SIGNALED && state !== gl.CONDITION_SATISFIED) {
        if (state === gl.WAIT_FAILED) { gl.deleteSync(sync); sync = null; broken = true; }
        return null;
      }
      gl.deleteSync(sync);
      sync = null;
      const data = new Uint8Array(width * height * 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, data);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      return { data, width, height };
    },
    dispose() {
      if (sync) gl.deleteSync(sync);
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      if (buffer) gl.deleteBuffer(buffer);
      sync = framebuffer = buffer = null;
    },
  };
}
