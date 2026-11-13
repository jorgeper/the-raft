package belringer.maps;

import android.content.Context;
import android.graphics.Color;
import android.opengl.GLES20;

import com.example.opengltest.R;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

class Grid {
    private static float[] GRID_COLOR = {0.5f, 0.5f, 0.5f, 0.5f};

    private int program;
    private FloatBuffer vertexBuffer;
    private float[] coords;

    private float[] makeCoords(int count, int step) {
        // Count lines times two sides. plus center line, times 6 coordinates per line, times 2 dimensions.
        float[] coords = new float[((count * 2) + 1) * 2 * 6];
        float halfWidth = count * step;
        int j = 0;
        for (int i = -count; i <= count; ++i) {
            coords[j++] = i * step;
            coords[j++] = 0.f;
            coords[j++] = -halfWidth;

            coords[j++] = i * step;
            coords[j++] = 0.f;
            coords[j++] = halfWidth;
        }

        for (int i = -count; i <= count; ++i) {
            coords[j++] = -halfWidth;
            coords[j++] = 0.f;
            coords[j++] = i * step;

            coords[j++] = halfWidth;
            coords[j++] = 0.f;
            coords[j++] = i * step;
        }

        return coords;
    }

    Grid(Context context, int count, int step) {
        coords = makeCoords(count, step);

        ByteBuffer bb = ByteBuffer.allocateDirect(coords.length * 4);
        bb.order(ByteOrder.nativeOrder());

        vertexBuffer = bb.asFloatBuffer();
        vertexBuffer.put(coords);
        vertexBuffer.position(0);

        String vertexShaderCode = Util.readTextFile(context, R.raw.simple_vertex_shader);
        int vertextShader = MapRenderer.loadShader(GLES20.GL_VERTEX_SHADER, vertexShaderCode);
        String fragmentShaderCode = Util.readTextFile(context, R.raw.fog_fragment_shader);
        int fragmentShader = MapRenderer.loadShader(GLES20.GL_FRAGMENT_SHADER, fragmentShaderCode);

        program = GLES20.glCreateProgram();

        GLES20.glAttachShader(program, vertextShader);
        GLES20.glAttachShader(program, fragmentShader);
        GLES20.glLinkProgram(program);
    }

    void draw(float[] mvpMatrix, Color fogColor) {
        GLES20.glUseProgram(program);
        int positionHandle = GLES20.glGetAttribLocation(program, "vPosition");
        GLES20.glEnableVertexAttribArray(positionHandle);
        GLES20.glVertexAttribPointer(positionHandle, 3, GLES20.GL_FLOAT, false, 4*3, vertexBuffer);

        int colorHandle = GLES20.glGetUniformLocation(program, "vColor");
        GLES20.glUniform4fv(colorHandle, 1, GRID_COLOR, 0);

        int fogColorHandle = GLES20.glGetUniformLocation(program, "vFogColor");
        GLES20.glUniform4fv(fogColorHandle, 1, fogColor.getComponents(), 0);

        int vPMatrixHandle = GLES20.glGetUniformLocation(program, "uMVPMatrix");
        GLES20.glUniformMatrix4fv(vPMatrixHandle, 1, false, mvpMatrix, 0);

        GLES20.glDrawArrays(GLES20.GL_LINES, 0, coords.length / 3);

        GLES20.glDisableVertexAttribArray(positionHandle);
    }
}