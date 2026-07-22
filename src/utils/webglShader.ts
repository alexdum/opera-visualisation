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
    // 2-channel measurement & quality
    vec4 texColor = texture2D(u_data_texture, v_texcoord);
    float value = texColor.r;
    float quality = texColor.a; // Using alpha channel for 2-channel texture (Luminance Alpha)
    
    if (quality < u_min_quality || value == 0.0) {
      discard;
    }
    
    vec4 color = texture2D(u_colormap_texture, vec2(value, 0.5));
    gl_FragColor = vec4(color.rgb, color.a * u_opacity);
  }
`;
