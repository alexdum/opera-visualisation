import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";
import { vertexShaderSource, fragmentShaderSource } from "../utils/webglShader";
import { getColorFromPalette } from "../utils/colors";

/** MapLibre GL JS v5 always requires WebGL2; if the map initialized, WebGL is available. */
export const isWebGLSupported = (_map: MapLibreMap): boolean => {
  try {
    return !!_map.getCanvas();
  } catch {
    return false;
  }
};

function hexToRgba(hex: string): [number, number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(hex);
  return result ? [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
    result[4] ? parseInt(result[4], 16) : 255
  ] : [0, 0, 0, 0];
}

type PendingFrameData = {
  frameId: string;
  rawBinaryBuffer: Uint8Array;
  width: number;
  height: number;
  bboxCoordinates: [number, number][];
  backend: "cog" | "geozarr";
  activate: boolean;
};

export class RadarWebGLLayer implements CustomLayerInterface {
  public id: string;
  public type = "custom" as const;
  public renderingMode = "2d" as const;

  private pendingFrames: Map<string, PendingFrameData> = new Map();

  private program: WebGLProgram | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private buffer: WebGLBuffer | null = null;

  private aPos: number = -1;
  private aTexCoord: number = -1;
  private uMatrix: WebGLUniformLocation | null = null;
  private uOpacity: WebGLUniformLocation | null = null;
  private uMinQuality: WebGLUniformLocation | null = null;
  private uSmooth: WebGLUniformLocation | null = null;

  private colormapTexture: WebGLTexture | null = null;
  
  // VRAM ring-buffer cache
  private textureCache: Map<string, {
    texture: WebGLTexture;
    quadCoords: Float32Array;
    backend: "cog" | "geozarr";
  }> = new Map();
  private maxCacheSize = 64;
  private cacheKeys: string[] = [];

  private currentTexture: WebGLTexture | null = null;
  private currentFrameId: string | null = null;
  private quadCoords: Float32Array = new Float32Array(0);

  public opacity: number = 1.0;
  public minQuality: number = 0.1;
  public smooth: boolean = true; // Use smart bilinear color interpolation by default
  public product: string = "DBZH";
  private map: MapLibreMap | null = null;

  constructor(id: string, product: string = "DBZH") {
    this.id = id;
    this.product = product;
  }

  public isInitialized(): boolean {
    return this.program !== null;
  }

  private compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Cannot create shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error("Shader compile error: " + message);
    }
    return shader;
  }

  private updateColormapTexture(gl: WebGL2RenderingContext) {
    if (!this.colormapTexture) return;
    
    // Create 1D colormap
    const colormapData = new Uint8Array(256 * 4);
    
    // Index 0: Nodata -> Transparent
    colormapData[0] = 0;
    colormapData[1] = 0;
    colormapData[2] = 0;
    colormapData[3] = 0;

    const PRODUCT_BOUNDS: Record<string, [number, number]> = {
      DBZH: [-35.0, 75.0],
      RATE: [-10.0, 150.0],
      ACRR: [-10.0, 300.0],
    };

    const [minVal, maxVal] = PRODUCT_BOUNDS[this.product] ?? [-35.0, 75.0];

    for (let i = 1; i <= 255; i++) {
      const val = minVal + ((i - 1) / 254) * (maxVal - minVal);
      let rgba: [number, number, number, number] = [120, 120, 120, 90];

      if (this.product === "DBZH") {
        if (val >= 0.0) {
          const colorHex = getColorFromPalette(val, "DBZH");
          rgba = hexToRgba(colorHex);
        }
      } else {
        // RATE and ACRR
        if (val >= 0.0) {
          const colorHex = getColorFromPalette(val, this.product);
          rgba = hexToRgba(colorHex);
        }
      }

      colormapData[i * 4] = rgba[0];
      colormapData[i * 4 + 1] = rgba[1];
      colormapData[i * 4 + 2] = rgba[2];
      colormapData[i * 4 + 3] = rgba[3];
    }

    gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, colormapData);
  }

  public onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.map = map;
    this.gl = gl;
    const vertexShader = this.compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = this.compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

    this.program = gl.createProgram();
    if (!this.program) throw new Error("Cannot create program");
    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error("Program link error: " + gl.getProgramInfoLog(this.program));
    }
    gl.detachShader(this.program, vertexShader);
    gl.detachShader(this.program, fragmentShader);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    this.aPos = gl.getAttribLocation(this.program, "a_pos");
    this.aTexCoord = gl.getAttribLocation(this.program, "a_texcoord");
    this.uMatrix = gl.getUniformLocation(this.program, "u_matrix");
    this.uOpacity = gl.getUniformLocation(this.program, "u_opacity");
    this.uMinQuality = gl.getUniformLocation(this.program, "u_min_quality");
    this.uSmooth = gl.getUniformLocation(this.program, "u_smooth");

    const uDataTexture = gl.getUniformLocation(this.program, "u_data_texture");
    const uColormapTexture = gl.getUniformLocation(this.program, "u_colormap_texture");

    gl.useProgram(this.program);
    gl.uniform1i(uDataTexture, 0);
    gl.uniform1i(uColormapTexture, 1);

    this.buffer = gl.createBuffer();

    this.colormapTexture = gl.createTexture();
    this.updateColormapTexture(gl);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (this.pendingFrames.size > 0) {
      const frames = Array.from(this.pendingFrames.values());
      this.pendingFrames.clear();
      for (const frame of frames) {
        this.setFrameData(
          frame.frameId,
          frame.rawBinaryBuffer,
          frame.width,
          frame.height,
          frame.bboxCoordinates,
          frame.backend,
          frame.activate
        );
      }
    }
  }

  public setProduct(product: string) {
    if (this.product === product) return;
    this.product = product;

    const gl = this.gl;
    if (gl && this.colormapTexture) {
      this.updateColormapTexture(gl);
    }

    if (gl) {
      for (const entry of this.textureCache.values()) {
        gl.deleteTexture(entry.texture);
      }
    }
    this.textureCache.clear();
    this.cacheKeys = [];
    this.currentTexture = null;
    this.currentFrameId = null;
    this.quadCoords = new Float32Array(0);
    this.pendingFrames.clear();
  }

  public hasFrame(frameId: string): boolean {
    return this.textureCache.has(frameId) || this.pendingFrames.has(frameId);
  }

  public showFrame(frameId: string): boolean {
    if (this.pendingFrames.has(frameId)) {
      this.pendingFrames.get(frameId)!.activate = true;
      return true;
    }
    const entry = this.textureCache.get(frameId);
    if (entry) {
      this.currentTexture = entry.texture;
      this.currentFrameId = frameId;
      this.quadCoords = entry.quadCoords;
      this.cacheKeys = this.cacheKeys.filter((key) => key !== frameId);
      this.cacheKeys.push(frameId);
      if (this.map) {
        this.map.triggerRepaint();
      }
      return true;
    }
    return false;
  }

  public clearFrame() {
    this.currentTexture = null;
    this.currentFrameId = null;
    this.quadCoords = new Float32Array(0);
    this.map?.triggerRepaint();
  }

  public visibleFrameId(): string | null {
    return this.currentFrameId;
  }

  public frameBackend(frameId: string): "cog" | "geozarr" | undefined {
    return this.textureCache.get(frameId)?.backend ?? this.pendingFrames.get(frameId)?.backend;
  }

  /**
   * Upload raw binary frame data into a GPU texture. Uses the stored GL
   * context from onAdd so callers do not need to access MapLibre internals.
   */
  public setFrameData(
    frameId: string,
    rawBinaryBuffer: Uint8Array,
    width: number,
    height: number,
    bboxCoordinates: [number, number][], // [ [nw_x, nw_y], [ne_x, ne_y], [se_x, se_y], [sw_x, sw_y] ] using Web Mercator coordinates
    backend: "cog" | "geozarr",
    activate = false,
  ) {
    const gl = this.gl;
    if (!gl) {
      this.pendingFrames.set(frameId, {
        frameId,
        rawBinaryBuffer,
        width,
        height,
        bboxCoordinates,
        backend,
        activate,
      });
      return;
    }
    if (width <= 0 || height <= 0 || rawBinaryBuffer.byteLength !== width * height * 2) {
      throw new Error("Invalid OPERA raw texture dimensions");
    }

    const quadCoords = new Float32Array([
      bboxCoordinates[0][0], bboxCoordinates[0][1], 0, 0,
      bboxCoordinates[1][0], bboxCoordinates[1][1], 1, 0,
      bboxCoordinates[2][0], bboxCoordinates[2][1], 1, 1,
      bboxCoordinates[0][0], bboxCoordinates[0][1], 0, 0,
      bboxCoordinates[2][0], bboxCoordinates[2][1], 1, 1,
      bboxCoordinates[3][0], bboxCoordinates[3][1], 0, 1,
    ]);

    if (this.textureCache.has(frameId)) {
      const cached = this.textureCache.get(frameId)!;
      cached.quadCoords = quadCoords;
      cached.backend = backend;
    } else {
      const texture = gl.createTexture();
      if (!texture) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, width, height, 0, gl.RG, gl.UNSIGNED_BYTE, rawBinaryBuffer);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.textureCache.set(frameId, { texture, quadCoords, backend });
      this.cacheKeys.push(frameId);

      while (this.cacheKeys.length > this.maxCacheSize) {
        // Hidden zoom/animation preloads must never evict the texture that is
        // currently being drawn; deleting the active WebGL texture produces
        // an otherwise unexplained blank radar layer.
        const evictionIndex = this.cacheKeys.findIndex((key) => key !== this.currentFrameId);
        if (evictionIndex < 0) break;
        const [oldest] = this.cacheKeys.splice(evictionIndex, 1);
        const oldEntry = this.textureCache.get(oldest);
        if (oldEntry) gl.deleteTexture(oldEntry.texture);
        this.textureCache.delete(oldest);
      }
    }
    if (activate) this.showFrame(frameId);
  }

  public render(glContext: WebGLRenderingContext | WebGL2RenderingContext, options: unknown): void {
    const gl = glContext as WebGL2RenderingContext;
    // MapLibre v5 passes CustomRenderMethodInput. For custom layers that
    // supply Mercator [0..1] coordinates, the correct matrix is
    // `defaultProjectionData.mainMatrix` — it is pre-scaled by EXTENT so
    // Mercator inputs map correctly to clip space. The top-level
    // `modelViewProjectionMatrix` uses unscaled tile/pixel units.
    const opts = options as Record<string, unknown> | undefined;
    const projData = opts?.defaultProjectionData as Record<string, unknown> | undefined;
    const matrix: Float32Array | number[] | undefined =
      (projData?.mainMatrix as Float32Array | undefined) ??
      (opts?.modelViewProjectionMatrix as Float32Array | undefined);

    if (!matrix || !this.program || !this.currentTexture || this.quadCoords.length === 0) return;

    gl.useProgram(this.program);

    gl.uniformMatrix4fv(this.uMatrix, false, matrix);
    gl.uniform1f(this.uOpacity, this.opacity);
    gl.uniform1f(this.uMinQuality, this.minQuality);
    gl.uniform1i(this.uSmooth, this.smooth ? 1 : 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.quadCoords, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 16, 0);

    gl.enableVertexAttribArray(this.aTexCoord);
    gl.vertexAttribPointer(this.aTexCoord, 2, gl.FLOAT, false, 16, 8);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.currentTexture);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture);

    // Premultiplied alpha blending is set by MapLibre before calling render().
    // The shader outputs premultiplied alpha to match.

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  public onRemove(_map: MapLibreMap, glContext: WebGLRenderingContext | WebGL2RenderingContext) {
    const gl = glContext as WebGL2RenderingContext;
    if (this.program) gl.deleteProgram(this.program);
    if (this.buffer) gl.deleteBuffer(this.buffer);
    if (this.colormapTexture) gl.deleteTexture(this.colormapTexture);
    
    for (const entry of this.textureCache.values()) {
      gl.deleteTexture(entry.texture);
    }
    this.textureCache.clear();
    this.cacheKeys = [];
    this.pendingFrames.clear();
    this.program = null;
    this.buffer = null;
    this.colormapTexture = null;
    this.gl = null;
    this.currentTexture = null;
    this.currentFrameId = null;
    this.quadCoords = new Float32Array(0);
  }
}
