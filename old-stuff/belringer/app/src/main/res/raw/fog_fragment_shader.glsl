precision mediump float;
uniform vec4 vColor;
uniform vec4 vFogColor;
void main() {
    if (vFogColor.a > 0.0) {
        const float density = 0.03;
        const float LOG2 = 1.442695;
        float z = gl_FragCoord.z / gl_FragCoord.w;
        float fogFactor = exp2(-density * density * z * z * LOG2);
        fogFactor = clamp(fogFactor, 0.0, 1.0);
        gl_FragColor = mix(vFogColor, vColor, fogFactor);
    } else {
        gl_FragColor = vColor;
    }
}