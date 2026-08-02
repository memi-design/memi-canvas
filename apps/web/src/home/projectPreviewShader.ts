const MAX_PIXEL_RATIO = 2;
const FRAME_INTERVAL = 1000 / 30;

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_pixel_ratio;
uniform float u_seed;
uniform float u_time;
uniform vec3 u_canvas;
uniform vec3 u_ruby;

float hash21(vec2 value) {
  value = fract(value * vec2(123.34, 456.21));
  value += dot(value, value + 45.32 + u_seed * 0.000001);
  return fract(value.x * value.y);
}

float bayer4(vec2 position) {
  vec2 cell = mod(floor(position), 4.0);
  float value = 0.0;
  if (cell.y < 1.0) {
    if (cell.x < 1.0) value = 0.0;
    else if (cell.x < 2.0) value = 8.0;
    else if (cell.x < 3.0) value = 2.0;
    else value = 10.0;
  } else if (cell.y < 2.0) {
    if (cell.x < 1.0) value = 12.0;
    else if (cell.x < 2.0) value = 4.0;
    else if (cell.x < 3.0) value = 14.0;
    else value = 6.0;
  } else if (cell.y < 3.0) {
    if (cell.x < 1.0) value = 3.0;
    else if (cell.x < 2.0) value = 11.0;
    else if (cell.x < 3.0) value = 1.0;
    else value = 9.0;
  } else {
    if (cell.x < 1.0) value = 15.0;
    else if (cell.x < 2.0) value = 7.0;
    else if (cell.x < 3.0) value = 13.0;
    else value = 5.0;
  }
  return (value + 0.5) / 16.0;
}

void main() {
  vec2 cssPixel = gl_FragCoord.xy / max(u_pixel_ratio, 1.0);
  vec2 cssResolution = u_resolution / max(u_pixel_ratio, 1.0);
  vec2 uv = cssPixel / max(cssResolution, vec2(1.0));
  float identity = fract(u_seed * 0.0000001192092896);
  float drift = u_time * mix(0.035, 0.075, fract(identity * 7.31));
  vec2 ditherCell = floor(cssPixel / 2.0);
  float threshold = bayer4(ditherCell);

  float waveA = 0.5 + 0.5 * sin(
    uv.x * mix(8.0, 18.0, identity) +
    uv.y * mix(5.0, 13.0, fract(identity * 5.17)) +
    drift +
    identity * 12.0
  );
  float waveB = 0.5 + 0.5 * cos(
    uv.y * mix(11.0, 24.0, fract(identity * 3.41)) -
    uv.x * mix(4.0, 9.0, identity) -
    drift * 1.37
  );
  vec2 focusA = vec2(
    0.18 + 0.64 * fract(identity * 17.13),
    0.18 + 0.64 * fract(identity * 29.71)
  );
  vec2 focusB = vec2(1.0 - focusA.y, 1.0 - focusA.x);
  float bloomA = exp(-distance(uv, focusA) * mix(3.0, 6.0, identity));
  float bloomB = exp(-distance(uv, focusB) * mix(4.0, 8.0, 1.0 - identity));
  vec2 region = floor(uv * vec2(13.0, 7.0));
  float regionNoise = hash21(region + u_seed * 0.017);
  float fineNoise = hash21(ditherCell + u_seed * 0.031);

  float density =
    0.12 +
    waveA * 0.24 +
    waveB * 0.18 +
    bloomA * 0.27 +
    bloomB * 0.16 +
    (regionNoise - 0.5) * 0.20 +
    (fineNoise - 0.5) * 0.08;
  density = clamp(density, 0.0, 1.0);

  float level = floor(density * 5.0) / 4.0;
  float lit = step(threshold, fract(density * 4.0));
  float opacity = clamp(level * mix(0.42, 1.0, lit), 0.0, 1.0);
  float sparkle = step(0.992, fineNoise) * smoothstep(0.62, 0.94, density);
  vec3 color = mix(u_canvas, u_ruby, opacity * 0.92);
  color += u_ruby * pow(density, 4.0) * 0.13;
  color += u_ruby * sparkle * 0.34;

  gl_FragColor = vec4(color, 1.0);
}
`;

export interface ShaderCanvasSize {
  readonly height: number;
  readonly pixelRatio: number;
  readonly width: number;
}

interface ShaderResources {
  readonly buffer: WebGLBuffer;
  readonly canvas: WebGLUniformLocation;
  readonly position: number;
  readonly pixelRatio: WebGLUniformLocation;
  readonly program: WebGLProgram;
  readonly resolution: WebGLUniformLocation;
  readonly ruby: WebGLUniformLocation;
  readonly seed: WebGLUniformLocation;
  readonly time: WebGLUniformLocation;
}

export function projectShaderSeed(identity: string): number {
  const normalized = identity.trim().normalize("NFKC").toLocaleLowerCase();
  const source = normalized === "" ? "untitled" : normalized;

  return Array.from(source).reduce((hash, character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return Math.imul(hash ^ codePoint, 16_777_619) >>> 0;
  }, 2_166_136_261);
}

export function fitShaderCanvasSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): ShaderCanvasSize {
  const pixelRatio = Math.min(
    MAX_PIXEL_RATIO,
    Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1),
  );

  return Object.freeze({
    height: Math.max(1, Math.round(Math.max(0, cssHeight) * pixelRatio)),
    pixelRatio,
    width: Math.max(1, Math.round(Math.max(0, cssWidth) * pixelRatio)),
  });
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) {
    throw new Error("Unable to allocate project preview shader.");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader) ?? "Unknown shader error.";
    gl.deleteShader(shader);
    throw new Error(`Unable to compile project preview shader: ${detail}`);
  }
  return shader;
}

function createResources(gl: WebGLRenderingContext): ShaderResources {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  const fragment = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    FRAGMENT_SHADER_SOURCE,
  );
  const program = gl.createProgram();
  if (program === null) {
    throw new Error("Unable to allocate project preview program.");
  }

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const detail = gl.getProgramInfoLog(program) ?? "Unknown program error.";
    gl.deleteProgram(program);
    throw new Error(`Unable to link project preview shader: ${detail}`);
  }

  const buffer = gl.createBuffer();
  const resolution = gl.getUniformLocation(program, "u_resolution");
  const canvas = gl.getUniformLocation(program, "u_canvas");
  const pixelRatio = gl.getUniformLocation(program, "u_pixel_ratio");
  const seed = gl.getUniformLocation(program, "u_seed");
  const ruby = gl.getUniformLocation(program, "u_ruby");
  const time = gl.getUniformLocation(program, "u_time");
  const position = gl.getAttribLocation(program, "a_position");
  if (
    buffer === null ||
    resolution === null ||
    canvas === null ||
    pixelRatio === null ||
    seed === null ||
    ruby === null ||
    time === null ||
    position < 0
  ) {
    if (buffer !== null) {
      gl.deleteBuffer(buffer);
    }
    gl.deleteProgram(program);
    throw new Error("Project preview shader inputs are unavailable.");
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );

  return Object.freeze({
    buffer,
    canvas,
    position,
    pixelRatio,
    program,
    resolution,
    ruby,
    seed,
    time,
  });
}

function readShaderColor(
  canvas: HTMLCanvasElement,
  property: "--project-preview-canvas-rgb" | "--project-preview-ruby-rgb",
  fallback: readonly [number, number, number],
): readonly [number, number, number] {
  const parsed = getComputedStyle(canvas)
    .getPropertyValue(property)
    .split(",")
    .map((value) => Number(value.trim()));
  const [red, green, blue] = parsed;
  return (
    red !== undefined &&
    green !== undefined &&
    blue !== undefined &&
    parsed.length === 3 &&
    [red, green, blue].every((value) => Number.isFinite(value))
  )
    ? ([red / 255, green / 255, blue / 255] as const)
    : fallback;
}

export function mountProjectPreviewShader(
  canvas: HTMLCanvasElement,
  seed: number,
  reducedMotion: boolean,
): () => void {
  if (typeof WebGLRenderingContext === "undefined") {
    return () => undefined;
  }

  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: "low-power",
    preserveDrawingBuffer: false,
    stencil: false,
  });
  if (gl === null) {
    return () => undefined;
  }

  let resources: ShaderResources;
  try {
    resources = createResources(gl);
  } catch {
    return () => undefined;
  }

  let disposed = false;
  let frame = 0;
  let lastFrame = -FRAME_INTERVAL;
  let visible = true;

  const resize = () => {
    const bounds = canvas.getBoundingClientRect();
    const size = fitShaderCanvasSize(
      bounds.width,
      bounds.height,
      window.devicePixelRatio,
    );
    if (canvas.width !== size.width || canvas.height !== size.height) {
      canvas.width = size.width;
      canvas.height = size.height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  };

  const draw = (timestamp: number) => {
    if (disposed || !visible) {
      return;
    }
    if (!reducedMotion && timestamp - lastFrame < FRAME_INTERVAL) {
      frame = window.requestAnimationFrame(draw);
      return;
    }
    lastFrame = timestamp;
    resize();
    gl.useProgram(resources.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.buffer);
    gl.enableVertexAttribArray(resources.position);
    gl.vertexAttribPointer(resources.position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(resources.resolution, canvas.width, canvas.height);
    const canvasColor = readShaderColor(canvas, "--project-preview-canvas-rgb", [0.025, 0.014, 0.019]);
    const rubyColor = readShaderColor(canvas, "--project-preview-ruby-rgb", [1, 0.329, 0.439]);
    gl.uniform3f(resources.canvas, ...canvasColor);
    gl.uniform1f(
      resources.pixelRatio,
      Math.min(MAX_PIXEL_RATIO, Math.max(1, window.devicePixelRatio)),
    );
    gl.uniform1f(resources.seed, seed);
    gl.uniform3f(resources.ruby, ...rubyColor);
    gl.uniform1f(resources.time, reducedMotion ? seed % 97 : timestamp / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!reducedMotion) {
      frame = window.requestAnimationFrame(draw);
    }
  };

  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          resize();
          if (reducedMotion) {
            draw(0);
          }
        });
  resizeObserver?.observe(canvas);

  const intersectionObserver =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(([entry]) => {
          const nextVisible = entry?.isIntersecting ?? true;
          if (nextVisible === visible) {
            return;
          }
          visible = nextVisible;
          if (visible && !reducedMotion) {
            frame = window.requestAnimationFrame(draw);
          } else {
            window.cancelAnimationFrame(frame);
          }
        });
  intersectionObserver?.observe(canvas);

  frame = window.requestAnimationFrame(draw);

  return () => {
    disposed = true;
    window.cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    gl.deleteBuffer(resources.buffer);
    gl.deleteProgram(resources.program);
  };
}
