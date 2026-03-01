package belringer.maps;

import android.content.Context;
import android.opengl.GLES20;

import com.example.opengltest.R;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

class Axes {
    private static float[] axesCoords = {
            0.f, 0.f, 0.f, // center
            1.f, 0.f, 0.0f, // x
            0.f, 0.f, 0.f, // center
            0.f, 1.f, 0.0f,  // y
            0.f, 0.f, 0.f, // center
            0.f, 0.f, 1.0f  // z
    };

    private int program;
    private FloatBuffer vertexBuffer;
    private float[] RED = {1.f, 0.f, 0.f, 0.5f};
    private float[] GREEN = {0.f, 1.f, 0.f, 0.5f};
    private float[] BLUE = {0.f, 0.f, 1.f, 0.5f};

    Axes(Context context) {
        ByteBuffer bb = ByteBuffer.allocateDirect(axesCoords.length * 4);
        bb.order(ByteOrder.nativeOrder());

        vertexBuffer = bb.asFloatBuffer();
        vertexBuffer.put(axesCoords);
        vertexBuffer.position(0);

        String vertexShaderCode = Util.readTextFile(context, R.raw.simple_vertex_shader);
        int vertextShader = MapRenderer.loadShader(GLES20.GL_VERTEX_SHADER, vertexShaderCode);
        String fragmentShaderCode = Util.readTextFile(context, R.raw.simple_fragment_shader);
        int fragmentShader = MapRenderer.loadShader(GLES20.GL_FRAGMENT_SHADER, fragmentShaderCode);

        program = GLES20.glCreateProgram();

        GLES20.glAttachShader(program, vertextShader);
        GLES20.glAttachShader(program, fragmentShader);
        GLES20.glLinkProgram(program);
    }

    void draw(float[] mvpMatrix) {
        GLES20.glUseProgram(program);
        int positionHandle = GLES20.glGetAttribLocation(program, "vPosition");
        GLES20.glEnableVertexAttribArray(positionHandle);
        GLES20.glVertexAttribPointer(positionHandle, 3, GLES20.GL_FLOAT, false, 4*3, vertexBuffer);

        int vPMatrixHandle = GLES20.glGetUniformLocation(program, "uMVPMatrix");
        GLES20.glUniformMatrix4fv(vPMatrixHandle, 1, false, mvpMatrix, 0);

        // X
        int colorHandle = GLES20.glGetUniformLocation(program, "vColor");
        GLES20.glUniform4fv(colorHandle, 1, RED, 0);
        GLES20.glDrawArrays(GLES20.GL_LINES, 0, 2);

        // Y
        colorHandle = GLES20.glGetUniformLocation(program, "vColor");
        GLES20.glUniform4fv(colorHandle, 1, GREEN, 0);
        GLES20.glDrawArrays(GLES20.GL_LINES, 2, 2);

        // Z
        colorHandle = GLES20.glGetUniformLocation(program, "vColor");
        GLES20.glUniform4fv(colorHandle, 1, BLUE, 0);
        GLES20.glDrawArrays(GLES20.GL_LINES, 4, 2);

        GLES20.glDisableVertexAttribArray(positionHandle);
    }
}