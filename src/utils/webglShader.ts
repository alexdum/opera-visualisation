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
  uniform bool u_smooth;
  out vec4 fragColor;
  
  vec4 getColor(vec4 texColor) {
    float measByte = texColor.r * 255.0;
    float qualByte = texColor.g * 255.0;
    
    // 0 is reserved for nodata
    if (measByte < 0.5) return vec4(0.0);
    
    // Quality check
    float quality = qualByte >= 254.5 ? 1.0 : (qualByte / 254.0);
    if (quality < u_min_quality) return vec4(0.0);
    
    // Sample colormap
    vec4 color = texture(u_colormap_texture, vec2(measByte / 255.0, 0.5));
    if (color.a < 0.01) return vec4(0.0);
    
    float finalAlpha = color.a * u_opacity;
    return vec4(color.rgb * finalAlpha, finalAlpha);
  }

  void main() {
    if (!u_smooth) {
      vec4 texColor = texture(u_data_texture, v_texcoord);
      vec4 c = getColor(texColor);
      if (c.a == 0.0) discard;
      fragColor = c;
    } else {
      ivec2 texSize = textureSize(u_data_texture, 0);
      vec2 texelSize = 1.0 / vec2(texSize);
      
      vec2 pixelPos = v_texcoord * vec2(texSize) - 0.5;
      vec2 f = fract(pixelPos);
      
      vec2 p00 = (floor(pixelPos) + 0.5) * texelSize;
      vec2 p10 = p00 + vec2(texelSize.x, 0.0);
      vec2 p01 = p00 + vec2(0.0, texelSize.y);
      vec2 p11 = p00 + vec2(texelSize.x, texelSize.y);

      vec4 c00 = getColor(texture(u_data_texture, p00));
      vec4 c10 = getColor(texture(u_data_texture, p10));
      vec4 c01 = getColor(texture(u_data_texture, p01));
      vec4 c11 = getColor(texture(u_data_texture, p11));

      vec4 colorTop = mix(c00, c10, f.x);
      vec4 colorBottom = mix(c01, c11, f.x);
      vec4 finalColor = mix(colorTop, colorBottom, f.y);
      
      if (finalColor.a == 0.0) discard;
      fragColor = finalColor;
    }
  }
`;
