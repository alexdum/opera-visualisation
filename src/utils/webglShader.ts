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

  float radarSampleScore(vec4 texColor) {
    float measByte = texColor.r * 255.0;
    float qualByte = texColor.g * 255.0;
    if (measByte < 0.5) return -1.0;

    float quality = qualByte >= 254.5 ? 1.0 : (qualByte / 254.0);
    if (quality < u_min_quality) return -1.0;

    vec4 color = texture(u_colormap_texture, vec2(measByte / 255.0, 0.5));
    return color.a < 0.01 ? -1.0 : measByte;
  }

  vec4 peakPreservingMinification(vec2 texelSize, vec2 footprint) {
    // Sample the full source footprint covered by this screen pixel. Choosing
    // the strongest valid echo prevents sparse one-pixel radar returns from
    // disappearing when the continental texture is drawn below 1:1 scale.
    // This changes only GPU sampling: the downloaded texture is unchanged.
    vec2 radius = 0.5 * max(footprint, vec2(1.0)) * texelSize;
    vec2 safeMin = 0.5 * texelSize;
    vec2 safeMax = vec2(1.0) - safeMin;
    vec4 strongest = vec4(0.0);
    float strongestScore = -1.0;

    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 offset = vec2(float(x), float(y)) * radius;
        vec2 samplePosition = clamp(v_texcoord + offset, safeMin, safeMax);
        vec4 candidate = texture(u_data_texture, samplePosition);
        float candidateScore = radarSampleScore(candidate);
        if (candidateScore > strongestScore) {
          strongest = candidate;
          strongestScore = candidateScore;
        }
      }
    }

    return strongestScore < 0.0 ? vec4(0.0) : getColor(strongest);
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

      // Estimate how many source texels contribute to one screen pixel. The
      // x/y gradients account for map scaling and projection without adding a
      // CPU uniform or requesting a larger image.
      vec2 footprint = vec2(
        length(vec2(dFdx(v_texcoord.x), dFdy(v_texcoord.x))) * float(texSize.x),
        length(vec2(dFdx(v_texcoord.y), dFdy(v_texcoord.y))) * float(texSize.y)
      );

      if (max(footprint.x, footprint.y) > 1.0) {
        vec4 minifiedColor = peakPreservingMinification(texelSize, footprint);
        if (minifiedColor.a == 0.0) discard;
        fragColor = minifiedColor;
        return;
      }
      
      vec2 pixelPos = v_texcoord * vec2(texSize) - 0.5;
      vec2 f = fract(pixelPos);
      
      // Make the smoothing "less aggressive" by steepening the interpolation curve.
      // A multiplier of 1.0 is standard linear (blurry). 
      // A multiplier of 3.0 leaves the center of the pixel flat and only blurs the very edges.
      f = clamp((f - 0.5) * 3.0 + 0.5, 0.0, 1.0);
      
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
