package belringer.maps;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.opengl.GLES20;
import android.opengl.Matrix;

import com.example.opengltest.R;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

public class TexturedQuad {
    private FloatBuffer vertexBuffer;
    private final int program;
    private final FloatBuffer texBuffer;
    private final int texDataHandle;

    // 1x1 quad laid out on the origin with y = 0
    static float unitQuad[] = {
            0.f, 0.f, 0.0f,
            0.f, 0.f, 1.0f,
            1.0f, 0.f, 0.0f,
            0.f, 0.f, 1.0f,
            1.0f, 0.f, 1.0f,
            1.0f, 0.f, 0.0f,
    };

    static float texCoords[] = {
        0.0f, 0.0f,
        0.0f, 1.0f,
        1.0f, 0.0f,
        0.0f, 1.0f,
        1.0f, 1.0f,
        1.0f, 0.0f,
    };

    TexturedQuad(Context context, int drawableId) {
        this(context, getBitmapFromDrawable(context, drawableId));
    }

    TexturedQuad(Context context, Bitmap bitmap) {
        ByteBuffer bb = ByteBuffer.allocateDirect(unitQuad.length * 4);
        bb.order(ByteOrder.nativeOrder());

        //float[] scaleM = new float[16];

//        float[] scaledV = new float[4];
//        Matrix.setIdentityM(scaleM, 0);
//        Matrix.scaleM(scaleM, 0, width, 1.f, height);
//        float[] v = new float[] { width, 0.f, height, 1.f};
//        Matrix.multiplyMV(scaledV, 0, scaleM, 0, v, 0);

        vertexBuffer = bb.asFloatBuffer();
        vertexBuffer.put(unitQuad);
        vertexBuffer.position(0);

        texBuffer = ByteBuffer.allocateDirect(texCoords.length * 4)
                .order(ByteOrder.nativeOrder()).asFloatBuffer();
        texBuffer.put(texCoords).position(0);

        texDataHandle = Util.loadTexture(bitmap);

        String vertexShaderCode = Util.readTextFile(context, R.raw.textured_vertex_shader);
        int vertexShader = MapRenderer.loadShader(GLES20.GL_VERTEX_SHADER, vertexShaderCode);
        String fragmentShaderCode = Util.readTextFile(context, R.raw.textured_fragment_shader);
        int fragmentShader = MapRenderer.loadShader(GLES20.GL_FRAGMENT_SHADER, fragmentShaderCode);

        program = GLES20.glCreateProgram();

        GLES20.glAttachShader(program, vertexShader);
        GLES20.glAttachShader(program, fragmentShader);
        GLES20.glLinkProgram(program);
    }

    void draw(float[] mvpMatrix) {
        GLES20.glUseProgram(program);

        int positionHandle = GLES20.glGetAttribLocation(program, "aPosition");
        GLES20.glEnableVertexAttribArray(positionHandle);
        GLES20.glVertexAttribPointer(positionHandle, 3, GLES20.GL_FLOAT, false, 4*3, vertexBuffer);

        // Pass in the texture coordinate information
        int texCoordinateHandle = GLES20.glGetAttribLocation(program, "aTexCoordinate");
        GLES20.glEnableVertexAttribArray(texCoordinateHandle);
        GLES20.glVertexAttribPointer(texCoordinateHandle, 2, GLES20.GL_FLOAT, false,
                0, texBuffer);

        int texHandle = GLES20.glGetUniformLocation(program, "uTexture");
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texDataHandle);
        // Tell the texture uniform sampler to use this texture in the shader by binding to texture unit 0.
        GLES20.glUniform1i(texHandle, 0);

        int vPMatrixHandle = GLES20.glGetUniformLocation(program, "uMVPMatrix");
        GLES20.glUniformMatrix4fv(vPMatrixHandle, 1, false, mvpMatrix, 0);

        GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, unitQuad.length / 3);
        GLES20.glDisableVertexAttribArray(positionHandle);
        GLES20.glDisableVertexAttribArray(texCoordinateHandle);
    }

    private static Bitmap getBitmapFromDrawable(Context context, int drawableId) {
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inScaled = false;   // No pre-scaling
        return BitmapFactory.decodeResource(context.getResources(), drawableId, options);
    }
}
