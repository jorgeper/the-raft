precision mediump float;

uniform sampler2D uTexture;

varying vec2 vTexCoordinate;   // Interpolated texture coordinate per fragment.

// The entry point for our fragment shader.
void main()
{
    gl_FragColor = texture2D(uTexture, vTexCoordinate);
//    gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);

//    if (gl_FragColor.a != 1.0) {
//       discard;
//    }
}