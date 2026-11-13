package belringer.maps;

import android.content.Context;
import android.graphics.Color;
import android.opengl.GLES20;

import com.example.opengltest.R;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

class Line {
    private int program;
    private FloatBuffer vertexBuffer;

    private static float AXES_COORDS[] = {
            0.f,  0.f, 0.f, // center
            1.f, 0.f, 0.0f, // x
    };

    Line(Context context) {
        ByteBuffer bb = ByteBuffer.allocateDirect(
                AXES_COORDS.length * 4);
        bb.order(ByteOrder.nativeOrder());

        vertexBuffer = bb.asFloatBuffer();
        vertexBuffer.put(AXES_COORDS);
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

    void draw(float[] mvpMatrix, Color color, float[] coords) {
        GLES20.glUseProgram(program);

        vertexBuffer.put(coords);
        vertexBuffer.position(0);

        int positionHandle = GLES20.glGetAttribLocation(program, "vPosition");
        GLES20.glEnableVertexAttribArray(positionHandle);
        GLES20.glVertexAttribPointer(positionHandle, 3, GLES20.GL_FLOAT, false, 4*3, vertexBuffer);

        int vPMatrixHandle = GLES20.glGetUniformLocation(program, "uMVPMatrix");
        GLES20.glUniformMatrix4fv(vPMatrixHandle, 1, false, mvpMatrix, 0);

        int colorHandle = GLES20.glGetUniformLocation(program, "vColor");
        GLES20.glUniform4fv(colorHandle, 1, color.getComponents(), 0);

        GLES20.glDrawArrays(GLES20.GL_LINES, 0, 2);

        GLES20.glDisableVertexAttribArray(positionHandle);
    }
}