import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";
import { vertexShaderSource, fragmentShaderSource } from "../utils/webglShader";
import { OPERA_DBZH_PALETTE, OPERA_PRECIP_PALETTE } from "../utils/colors";

export const isWebGLSupported = (map: MapLibreMap): boolean => {
  return !!map.getCanvas().getContext("webgl") || !!map.getCanvas().getContext("webgl2");
};

function hexToRgba(hex: string): [number, number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
    255
  ] : [0, 0, 0, 0];
}

export class RadarWebGLLayer implements CustomLayerInterface {
  public id: string;
  public type = "custom" as const;
  public renderingMode = "2d" as const;

  private program: WebGLProgram | null = null;
  private gl: WebGLRenderingContext | null = null;
  private buffer: WebGLBuffer | null = null;

  private aPos: number = -1;
  private aTexCoord: number = -1;
  private uMatrix: WebGLUniformLocation | null = null;
  private uOpacity: WebGLUniformLocation | null = null;
  private uMinQuality: WebGLUniformLocation | null = null;

  private colormapTexture: WebGLTexture | null = null;
  
  // VRAM ring-buffer cache
  private textureCache: Map<string, WebGLTexture> = new Map();
  private maxCacheSize = 8;
  private cacheKeys: string[] = [];

  private currentTexture: WebGLTexture | null = null;
  private quadCoords: Float32Array = new Float32Array(0);

  public opacity: number = 1.0;
  public minQuality: number = 0.1;
  public product: string = "DBZH";
  private map: MapLibreMap | null = null;

  constructor(id: string, product: string = "DBZH") {
    this.id = id;
    this.product = product;
  }

  private compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Cannot create shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error("Shader compile error: " + gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  public onAdd(map: MapLibreMap, gl: WebGLRenderingContext) {
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

    this.aPos = gl.getAttribLocation(this.program, "a_pos");
    this.aTexCoord = gl.getAttribLocation(this.program, "a_texcoord");
    this.uMatrix = gl.getUniformLocation(this.program, "u_matrix");
    this.uOpacity = gl.getUniformLocation(this.program, "u_opacity");
    this.uMinQuality = gl.getUniformLocation(this.program, "u_min_quality");

    const uDataTexture = gl.getUniformLocation(this.program, "u_data_texture");
    const uColormapTexture = gl.getUniformLocation(this.program, "u_colormap_texture");

    gl.useProgram(this.program);
    gl.uniform1i(uDataTexture, 0);
    gl.uniform1i(uColormapTexture, 1);

    this.buffer = gl.createBuffer();

    // Create 1D colormap
    const palette = (this.product === "RATE" || this.product === "ACRR") ? OPERA_PRECIP_PALETTE : OPERA_DBZH_PALETTE;
    const colormapData = new Uint8Array(256 * 4);
    
    // Simple mapping: evenly distribute palette or map by val ranges
    const minVal = palette[0].val;
    const maxVal = palette[palette.length - 1].val;
    for (let i = 0; i < 256; i++) {
      const val = minVal + (i / 255) * (maxVal - minVal);
      let colorHex = palette[0].color;
      for (let j = 0; j < palette.length; j++) {
        if (val >= palette[j].val) colorHex = palette[j].color;
      }
      const rgba = hexToRgba(colorHex);
      colormapData[i * 4] = rgba[0];
      colormapData[i * 4 + 1] = rgba[1];
      colormapData[i * 4 + 2] = rgba[2];
      colormapData[i * 4 + 3] = val > minVal ? rgba[3] : 0; // hide values below min
    }

    this.colormapTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.colormapTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, colormapData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  public setFrameData(
    gl: WebGLRenderingContext,
    frameId: string,
    rawBinaryBuffer: Uint8Array,
    width: number,
    height: number,
    bboxCoordinates: [number, number][] // [ [nw_x, nw_y], [ne_x, ne_y], [se_x, se_y], [sw_x, sw_y] ] using Web Mercator coordinates
  ) {
    if (this.textureCache.has(frameId)) {
      this.currentTexture = this.textureCache.get(frameId)!;
    } else {
      const texture = gl.createTexture();
      if (!texture) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      // Assuming Luminance Alpha (2 channels)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, width, height, 0, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, rawBinaryBuffer);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.textureCache.set(frameId, texture);
      this.cacheKeys.push(frameId);

      if (this.cacheKeys.length > this.maxCacheSize) {
        const oldest = this.cacheKeys.shift();
        if (oldest) {
          const oldTex = this.textureCache.get(oldest);
          if (oldTex) gl.deleteTexture(oldTex);
          this.textureCache.delete(oldest);
        }
      }
      this.currentTexture = texture;
    }

    // Quad: 2 triangles, 6 vertices. Each vertex is (x, y, u, v)
    // MapLibre gives custom layers the Mercator coordinate space
    this.quadCoords = new Float32Array([
      // Triangle 1
      bboxCoordinates[0][0], bboxCoordinates[0][1], 0, 0, // NW
      bboxCoordinates[1][0], bboxCoordinates[1][1], 1, 0, // NE
      bboxCoordinates[2][0], bboxCoordinates[2][1], 1, 1, // SE
      
      // Triangle 2
      bboxCoordinates[0][0], bboxCoordinates[0][1], 0, 0, // NW
      bboxCoordinates[2][0], bboxCoordinates[2][1], 1, 1, // SE
      bboxCoordinates[3][0], bboxCoordinates[3][1], 0, 1  // SW
    ]);

    if (this.map) {
      this.map.triggerRepaint();
    }
  }

  public render(gl: WebGLRenderingContext | WebGL2RenderingContext, matrixOrOptions: unknown): void {
    const opts = matrixOrOptions as { defaultProjectionData?: { mainMatrix?: number[] }; matrix?: number[] } | number[] | undefined;
    const matrix: number[] | undefined = Array.isArray(opts)
      ? opts
      : (opts?.defaultProjectionData?.mainMatrix ?? opts?.matrix);

    if (!matrix || !this.program || !this.currentTexture || this.quadCoords.length === 0) return;

    gl.useProgram(this.program);

    gl.uniformMatrix4fv(this.uMatrix, false, matrix);
    gl.uniform1f(this.uOpacity, this.opacity);
    gl.uniform1f(this.uMinQuality, this.minQuality);

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

    // Transparency support
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  public onRemove(map: MapLibreMap, gl: WebGLRenderingContext) {
    if (this.program) gl.deleteProgram(this.program);
    if (this.buffer) gl.deleteBuffer(this.buffer);
    if (this.colormapTexture) gl.deleteTexture(this.colormapTexture);
    
    for (const tex of this.textureCache.values()) {
      gl.deleteTexture(tex);
    }
    this.textureCache.clear();
    this.cacheKeys = [];
  }
}
