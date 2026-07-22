export const vertexShaderSource = `#version 300 es
  in vec2 a_pos;
  in vec2 a_texcoord;
  uniform mat4 u_matrix;
  out vec2 v_texcoord;
  void main() {
    gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
    v_texcoord = a_texcoord;
  }
`;

export const fragmentShaderSource = `#version 300 es
  precision mediump float;
  in vec2 v_texcoord;
  uniform sampler2D u_data_texture;
  uniform sampler2D u_colormap_texture;
  uniform float u_opacity;
  uniform float u_min_quality;
  out vec4 fragColor;
  
  void main() {
    // WebGL2 RG8 texture: red = measurement, green = quality.
    vec4 texColor = texture(u_data_texture, v_texcoord);
    float measByte = texColor.r * 255.0;
    float qualByte = texColor.g * 255.0;
    
    // 0 is reserved for nodata (NaN / invalid)
    if (measByte < 0.5) {
      discard;
    }
    
    // Quality check: 255 is unknown (valid), otherwise qualByte / 254.0
    float quality = qualByte >= 254.5 ? 1.0 : (qualByte / 254.0);
    if (quality < u_min_quality) {
      discard;
    }
    
    // Sample colormap (texcoord x = measByte / 255.0)
    vec4 color = texture(u_colormap_texture, vec2(measByte / 255.0, 0.5));
    
    // Discard transparent colors
    if (color.a < 0.01) {
      discard;
    }
    
    // MapLibre expects premultiplied alpha output for its blend mode
    // gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA).
    float finalAlpha = color.a * u_opacity;
    fragColor = vec4(color.rgb * finalAlpha, finalAlpha);
  }
`;
