export const vertexShaderSource = `
  attribute vec2 a_pos;
  attribute vec2 a_texcoord;
  uniform mat4 u_matrix;
  varying vec2 v_texcoord;
  void main() {
    gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
    v_texcoord = a_texcoord;
  }
`;

export const fragmentShaderSource = `
  precision mediump float;
  varying vec2 v_texcoord;
  uniform sampler2D u_data_texture;
  uniform sampler2D u_colormap_texture;
  uniform float u_opacity;
  uniform float u_min_quality;
  
  void main() {
    // 2-channel measurement & quality (Luminance Alpha: r = meas, a = quality)
    vec4 texColor = texture2D(u_data_texture, v_texcoord);
    float measByte = texColor.r * 255.0;
    float qualByte = texColor.a * 255.0;
    
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
    vec4 color = texture2D(u_colormap_texture, vec2(measByte / 255.0, 0.5));
    
    // Discard transparent colors
    if (color.a < 0.01) {
      discard;
    }
    
    gl_FragColor = vec4(color.rgb, color.a * u_opacity);
  }
`;
