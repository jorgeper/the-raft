uniform mat4 uMVPMatrix;       // A constant representing the combined model/view/projection matrix.

attribute vec4 aPosition;
attribute vec2 aTexCoordinate; // Per-vertex texture coordinate information we will pass in.

varying vec2 vTexCoordinate;   // This will be passed into the fragment shader.

// The entry point for our vertex shader.
void main()
{
    // Pass through the texture coordinate.
    vTexCoordinate = aTexCoordinate;

    gl_Position = uMVPMatrix * aPosition;
}
