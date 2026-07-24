import { describe, expect, it } from "vitest";

import { RadarWebGLLayer } from "./RadarWebGLLayer";
import { fragmentShaderSource, vertexShaderSource } from "../utils/webglShader";

describe("RadarWebGLLayer texture activation", () => {
  it("keeps a hidden preload from replacing the visible frame", () => {
    const uploads: Array<{ internalFormat: number; format: number }> = [];
    const fakeGl = {
      TEXTURE_2D: 3553,
      RG8: 33323,
      RG: 33319,
      UNSIGNED_BYTE: 5121,
      TEXTURE_MIN_FILTER: 10241,
      TEXTURE_MAG_FILTER: 10240,
      TEXTURE_WRAP_S: 10242,
      TEXTURE_WRAP_T: 10243,
      NEAREST: 9728,
      CLAMP_TO_EDGE: 33071,
      createTexture: () => ({}),
      bindTexture: () => undefined,
      pixelStorei: () => undefined,
      texImage2D: (_target: number, _level: number, internalFormat: number, _width: number, _height: number, _border: number, format: number) => {
        uploads.push({ internalFormat, format });
      },
      texParameteri: () => undefined,
      deleteTexture: () => undefined,
    } as unknown as WebGL2RenderingContext;
    const layer = new RadarWebGLLayer("radar", "DBZH");
    Object.defineProperty(layer, "gl", { value: fakeGl, configurable: true });
    const payload = new Uint8Array(8);
    const continental: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const regional: [number, number][] = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4]];

    layer.setFrameData("current", payload, 2, 2, continental, "cog", true);
    layer.setFrameData("preload", payload, 2, 2, regional, "cog", false);

    expect(layer.visibleFrameId()).toBe("current");
    expect(layer.frameBackend("preload")).toBe("cog");
    expect(uploads).toEqual([
      { internalFormat: fakeGl.RG8, format: fakeGl.RG },
      { internalFormat: fakeGl.RG8, format: fakeGl.RG },
    ]);
    expect(layer.showFrame("preload")).toBe(true);
    expect(layer.visibleFrameId()).toBe("preload");
  });

  it("uses GLSL ES 3 shaders for the WebGL2 map context", () => {
    expect(vertexShaderSource.startsWith("#version 300 es\n")).toBe(true);
    expect(fragmentShaderSource.startsWith("#version 300 es\n")).toBe(true);
    expect(fragmentShaderSource).toContain("texColor.g");
  });

  it("preserves peak radar echoes when the texture is minified", () => {
    expect(fragmentShaderSource).toContain("dFdx(v_texcoord.x)");
    expect(fragmentShaderSource).toContain("peakPreservingMinification");
    expect(fragmentShaderSource).toContain("candidateScore > strongestScore");
    expect(fragmentShaderSource).toContain("quality < u_min_quality");
  });

  it("does not evict the visible texture when hidden zoom crops fill the cache", () => {
    const deleted: WebGLTexture[] = [];
    const fakeGl = {
      TEXTURE_2D: 3553,
      RG8: 33323,
      RG: 33319,
      UNSIGNED_BYTE: 5121,
      TEXTURE_MIN_FILTER: 10241,
      TEXTURE_MAG_FILTER: 10240,
      TEXTURE_WRAP_S: 10242,
      TEXTURE_WRAP_T: 10243,
      NEAREST: 9728,
      CLAMP_TO_EDGE: 33071,
      createTexture: () => ({}) as WebGLTexture,
      bindTexture: () => undefined,
      pixelStorei: () => undefined,
      texImage2D: () => undefined,
      texParameteri: () => undefined,
      deleteTexture: (texture: WebGLTexture) => deleted.push(texture),
    } as unknown as WebGL2RenderingContext;
    const layer = new RadarWebGLLayer("radar", "DBZH");
    Object.defineProperty(layer, "gl", { value: fakeGl, configurable: true });
    const payload = new Uint8Array(8);
    const coordinates: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];

    layer.setFrameData("visible", payload, 2, 2, coordinates, "cog", true);
    for (let index = 0; index < 65; index += 1) {
      layer.setFrameData(`hidden-${index}`, payload, 2, 2, coordinates, "cog", false);
    }

    expect(layer.visibleFrameId()).toBe("visible");
    expect(layer.hasFrame("visible")).toBe(true);
    expect(deleted).toHaveLength(2);
  });

  it("resets initialization status and clears texture cache on removal", () => {
    const deleted: WebGLTexture[] = [];
    const fakeGl = {
      TEXTURE_2D: 3553,
      RG8: 33323,
      RG: 33319,
      UNSIGNED_BYTE: 5121,
      TEXTURE_MIN_FILTER: 10241,
      TEXTURE_MAG_FILTER: 10240,
      TEXTURE_WRAP_S: 10242,
      TEXTURE_WRAP_T: 10243,
      NEAREST: 9728,
      CLAMP_TO_EDGE: 33071,
      createTexture: () => ({}) as WebGLTexture,
      bindTexture: () => undefined,
      pixelStorei: () => undefined,
      texImage2D: () => undefined,
      texParameteri: () => undefined,
      deleteProgram: () => undefined,
      deleteBuffer: () => undefined,
      deleteTexture: (texture: WebGLTexture) => deleted.push(texture),
    } as unknown as WebGL2RenderingContext;
    const layer = new RadarWebGLLayer("radar", "DBZH");
    Object.defineProperty(layer, "gl", { value: fakeGl, configurable: true });
    Object.defineProperty(layer, "program", { value: {} as WebGLProgram, writable: true, configurable: true });

    expect(layer.isInitialized()).toBe(true);
    layer.setFrameData("frame-1", new Uint8Array(8), 2, 2, [[0, 0], [1, 0], [1, 1], [0, 1]], "cog", true);
    expect(layer.hasFrame("frame-1")).toBe(true);

    layer.onRemove({} as never, fakeGl);

    expect(layer.isInitialized()).toBe(false);
    expect(layer.hasFrame("frame-1")).toBe(false);
    expect(layer.visibleFrameId()).toBeNull();
    expect(deleted).toHaveLength(1);
  });
});

describe("RadarWebGLLayer render matrix extraction", () => {
  function setupRenderLayer(fakeGl: WebGL2RenderingContext) {
    const layer = new RadarWebGLLayer("radar", "DBZH");
    Object.defineProperty(layer, "gl", { value: fakeGl, configurable: true });
    Object.defineProperty(layer, "program", { value: {} as WebGLProgram, writable: true, configurable: true });
    layer.setFrameData("frame-1", new Uint8Array(8), 2, 2, [[0, 0], [1, 0], [1, 1], [0, 1]], "cog", true);
    return layer;
  }

  it("extracts matrix from direct Float32Array options", () => {
    let passedMatrix: Float32Array | number[] | undefined;
    const fakeGl = {
      ARRAY_BUFFER: 34962,
      STATIC_DRAW: 35044,
      FLOAT: 5126,
      TEXTURE0: 33984,
      TEXTURE1: 33985,
      TRIANGLES: 4,
      createTexture: () => ({}) as WebGLTexture,
      bindTexture: () => undefined,
      pixelStorei: () => undefined,
      texImage2D: () => undefined,
      texParameteri: () => undefined,
      useProgram: () => undefined,
      uniformMatrix4fv: (_loc: unknown, _trans: boolean, mat: Float32Array | number[]) => {
        passedMatrix = mat;
      },
      uniform1f: () => undefined,
      uniform1i: () => undefined,
      bindBuffer: () => undefined,
      bufferData: () => undefined,
      enableVertexAttribArray: () => undefined,
      vertexAttribPointer: () => undefined,
      activeTexture: () => undefined,
      drawArrays: () => undefined,
    } as unknown as WebGL2RenderingContext;

    const layer = setupRenderLayer(fakeGl);
    const directMatrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

    layer.render(fakeGl, directMatrix);
    expect(passedMatrix).toBe(directMatrix);
  });

  it("extracts matrix from options object with defaultProjectionData or modelViewProjectionMatrix", () => {
    let passedMatrix: Float32Array | number[] | undefined;
    const fakeGl = {
      ARRAY_BUFFER: 34962,
      STATIC_DRAW: 35044,
      FLOAT: 5126,
      TEXTURE0: 33984,
      TEXTURE1: 33985,
      TRIANGLES: 4,
      createTexture: () => ({}) as WebGLTexture,
      bindTexture: () => undefined,
      pixelStorei: () => undefined,
      texImage2D: () => undefined,
      texParameteri: () => undefined,
      useProgram: () => undefined,
      uniformMatrix4fv: (_loc: unknown, _trans: boolean, mat: Float32Array | number[]) => {
        passedMatrix = mat;
      },
      uniform1f: () => undefined,
      uniform1i: () => undefined,
      bindBuffer: () => undefined,
      bufferData: () => undefined,
      enableVertexAttribArray: () => undefined,
      vertexAttribPointer: () => undefined,
      activeTexture: () => undefined,
      drawArrays: () => undefined,
    } as unknown as WebGL2RenderingContext;

    const layer = setupRenderLayer(fakeGl);
    const mainMatrix = new Float32Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]);
    const mvpMatrix = new Float32Array([3, 0, 0, 0, 0, 3, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1]);

    // Test defaultProjectionData.mainMatrix
    layer.render(fakeGl, { defaultProjectionData: { mainMatrix } });
    expect(passedMatrix).toBe(mainMatrix);

    // Test modelViewProjectionMatrix fallback when defaultProjectionData is absent
    layer.render(fakeGl, { modelViewProjectionMatrix: mvpMatrix });
    expect(passedMatrix).toBe(mvpMatrix);
  });

  it("falls back to map transform customLayerMatrix when options has no matrix", () => {
    let passedMatrix: Float32Array | number[] | undefined;
    const fakeGl = {
      ARRAY_BUFFER: 34962,
      STATIC_DRAW: 35044,
      FLOAT: 5126,
      TEXTURE0: 33984,
      TEXTURE1: 33985,
      TRIANGLES: 4,
      createTexture: () => ({}) as WebGLTexture,
      bindTexture: () => undefined,
      pixelStorei: () => undefined,
      texImage2D: () => undefined,
      texParameteri: () => undefined,
      useProgram: () => undefined,
      uniformMatrix4fv: (_loc: unknown, _trans: boolean, mat: Float32Array | number[]) => {
        passedMatrix = mat;
      },
      uniform1f: () => undefined,
      uniform1i: () => undefined,
      bindBuffer: () => undefined,
      bufferData: () => undefined,
      enableVertexAttribArray: () => undefined,
      vertexAttribPointer: () => undefined,
      activeTexture: () => undefined,
      drawArrays: () => undefined,
    } as unknown as WebGL2RenderingContext;

    const layer = setupRenderLayer(fakeGl);
    const transformMatrix = new Float32Array([4, 0, 0, 0, 0, 4, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1]);

    const fakeMap = {
      transform: {
        customLayerMatrix: () => transformMatrix,
      },
    };
    Object.defineProperty(layer, "map", { value: fakeMap, configurable: true });

    // Call render with empty options object
    layer.render(fakeGl, {});
    expect(passedMatrix).toBe(transformMatrix);
  });
});

