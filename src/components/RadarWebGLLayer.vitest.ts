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
      texImage2D: () => undefined,
      texParameteri: () => undefined,
      deleteTexture: (texture: WebGLTexture) => deleted.push(texture),
    } as unknown as WebGL2RenderingContext;
    const layer = new RadarWebGLLayer("radar", "DBZH");
    Object.defineProperty(layer, "gl", { value: fakeGl, configurable: true });
    const payload = new Uint8Array(8);
    const coordinates: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];

    layer.setFrameData("visible", payload, 2, 2, coordinates, "cog", true);
    for (let index = 0; index < 9; index += 1) {
      layer.setFrameData(`hidden-${index}`, payload, 2, 2, coordinates, "cog", false);
    }

    expect(layer.visibleFrameId()).toBe("visible");
    expect(layer.hasFrame("visible")).toBe(true);
    expect(deleted).toHaveLength(2);
  });
});
