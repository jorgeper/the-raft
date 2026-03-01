package belringer.maps;

import android.content.Context;
import android.graphics.Color;
import android.opengl.GLES20;

import com.example.opengltest.R;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.ShortBuffer;

public class Plane{
    private int program;
    private FloatBuffer vertexBuffer;
    private ShortBuffer drawListBuffer;
    private float coords[];
    private short indices[];

    static Plane quad(Context context, float width, float height) {
        return new Plane(context, 2, 2, width, height);
    }

    Plane(Context context, int width, int height, float stepW, float stepH) {
        makePlane(width, height, stepW, stepH);

        ByteBuffer bb = ByteBuffer.allocateDirect(coords.length * 4);
        bb.order(ByteOrder.nativeOrder());

        vertexBuffer = bb.asFloatBuffer();
        vertexBuffer.put(coords);
        vertexBuffer.position(0);

        ByteBuffer dlb = ByteBuffer.allocateDirect(indices.length * 2);
        dlb.order(ByteOrder.nativeOrder());
        drawListBuffer = dlb.asShortBuffer();
        drawListBuffer.put(indices);
        drawListBuffer.position(0);

        String vertexShaderCode = Util.readTextFile(context, R.raw.simple_vertex_shader);
        int vertextShader = MapRenderer.loadShader(GLES20.GL_VERTEX_SHADER, vertexShaderCode);
        String fragmentShaderCode = Util.readTextFile(context, R.raw.fog_fragment_shader);
        int fragmentShader = MapRenderer.loadShader(GLES20.GL_FRAGMENT_SHADER, fragmentShaderCode);

        program = GLES20.glCreateProgram();

        GLES20.glAttachShader(program, vertextShader);
        GLES20.glAttachShader(program, fragmentShader);
        GLES20.glLinkProgram(program);
    }

    private void makePlane(int width, int height, float stepW, float stepH) {
        coords = new float[width * height * 3]; // 3 coords per vertex
        indices = new short[(height-1) * width  * 2];

        short k = 0;
        for (int i = 0; i < height; ++i) {
            for (int j = 0; j < width; ++j) {
                coords[k++] = j * stepW;
                coords[k++] = 0.f;
                coords[k++] = i * stepH;
            }
        }

        k = 0;
        for (short i = 0; i < height -1 ; ++i) {
            for (short j = 0; j < width ; ++j) {
                short l = (short)(i * width + j);

                indices[k++] = l;
                indices[k++] = (short)(l + width);
            }
        }
    }

    void draw(float[] mvpMatrix, Color color, Color fogColor) {
        GLES20.glUseProgram(program);
        int positionHandle = GLES20.glGetAttribLocation(program, "vPosition");
        GLES20.glEnableVertexAttribArray(positionHandle);
        GLES20.glVertexAttribPointer(positionHandle, 3, GLES20.GL_FLOAT, false, 4*3, vertexBuffer);

        int colorHandle = GLES20.glGetUniformLocation(program, "vColor");
        GLES20.glUniform4fv(colorHandle, 1, color.getComponents(), 0);

        int fogColorHandle = GLES20.glGetUniformLocation(program, "vFogColor");
        GLES20.glUniform4fv(fogColorHandle, 1, fogColor.getComponents(), 0);

        int vPMatrixHandle = GLES20.glGetUniformLocation(program, "uMVPMatrix");
        // Pass the projection and view transformation to the shader
        GLES20.glUniformMatrix4fv(vPMatrixHandle, 1, false, mvpMatrix, 0);

        GLES20.glDrawElements(GLES20.GL_TRIANGLE_STRIP, indices.length, GLES20.GL_UNSIGNED_SHORT, drawListBuffer);
        GLES20.glDisableVertexAttribArray(positionHandle);
    }
}