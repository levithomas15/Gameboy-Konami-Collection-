/**
 * Screen renderers. Both expose the same shape so the emulator never knows
 * which one it is talking to:
 *
 *   upload(rgba)  copy a 160x144 RGBA frame in
 *   present()     draw it
 *   destroy()     release GPU resources
 */

export const SCREEN_W = 160;
export const SCREEN_H = 144;

/** binjgb writes into a 256x256 area; only the top-left 160x144 is the screen. */
const TEX_SIZE = 256;

class Canvas2DRenderer {
  constructor(canvas) {
    this.kind = '2d';
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('no 2d context');
    this.ctx.imageSmoothingEnabled = false;
    this.image = this.ctx.createImageData(SCREEN_W, SCREEN_H);
  }

  upload(rgba) {
    // The source may be wider than one screen row; copy row by row.
    const dst = this.image.data;
    if (rgba.length === dst.length) {
      dst.set(rgba);
    } else {
      for (let y = 0; y < SCREEN_H; y++) {
        const from = y * TEX_SIZE * 4;
        dst.set(rgba.subarray(from, from + SCREEN_W * 4), y * SCREEN_W * 4);
      }
    }
  }

  present() {
    this.ctx.putImageData(this.image, 0, 0);
  }

  destroy() {
    this.image = null;
    this.ctx = null;
  }
}

class WebGLRenderer {
  constructor(canvas) {
    this.kind = 'webgl';
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('no webgl context');
    this.gl = gl;

    const w = SCREEN_W / TEX_SIZE;
    const h = SCREEN_H / TEX_SIZE;

    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, h,
      +1, -1, w, h,
      -1, +1, 0, 0,
      +1, +1, w, 0,
    ]), gl.STATIC_DRAW);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TEX_SIZE, TEX_SIZE, 0,
                  gl.RGBA, gl.UNSIGNED_BYTE, null);
    // NEAREST everywhere: this is a pixel display, never interpolate it.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.program = this.#link(
      `attribute vec2 aPos;
       attribute vec2 aTex;
       varying highp vec2 vTex;
       void main() { gl_Position = vec4(aPos, 0.0, 1.0); vTex = aTex; }`,
      `varying highp vec2 vTex;
       uniform sampler2D uTex;
       void main() { gl_FragColor = texture2D(uTex, vTex); }`
    );
    gl.useProgram(this.program);

    const aPos = gl.getAttribLocation(this.program, 'aPos');
    const aTex = gl.getAttribLocation(this.program, 'aTex');
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aTex);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 16, 8);
    gl.uniform1i(gl.getUniformLocation(this.program, 'uTex'), 0);
  }

  #link(vertexSource, fragmentSource) {
    const gl = this.gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`shader: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`program: ${gl.getProgramInfoLog(program)}`);
    }
    return program;
  }

  upload(rgba) {
    const gl = this.gl;
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SCREEN_W, SCREEN_H,
                     gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  }

  present() {
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  destroy() {
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    gl.deleteBuffer(this.buffer);
    gl.deleteProgram(this.program);
    this.gl = null;
  }
}

/**
 * iOS Safari does not honour `image-rendering: pixelated` when upscaling a
 * WebGL canvas, which makes the screen a blurry mess. Canvas2D scales
 * correctly there, so prefer it on Apple handhelds.
 * See https://bugs.webkit.org/show_bug.cgi?id=193895
 */
function prefersCanvas2D() {
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) ||
              (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return iOS;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{force?: 'webgl'|'2d'}} [options]
 */
export function createRenderer(canvas, options = {}) {
  canvas.width = SCREEN_W;
  canvas.height = SCREEN_H;

  const force = options.force;
  if (force === '2d' || (!force && prefersCanvas2D())) {
    return new Canvas2DRenderer(canvas);
  }
  try {
    return new WebGLRenderer(canvas);
  } catch (error) {
    console.warn('WebGL unavailable, falling back to Canvas2D:', error.message);
    return new Canvas2DRenderer(canvas);
  }
}
