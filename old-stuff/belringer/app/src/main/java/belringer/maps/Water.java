package belringer.maps;

import android.content.Context;
import android.opengl.Matrix;

public class Water {
    private final Plane park;
    private final Text name;
    private final float x;
    private final float z;
    private final float w;
    private final float h;

    Water(Context context, String name, float x, float z, float w, float h) {
        if (name != null) {
            this.name = new Text(context, name, Constants.WATER_TEXT_COLOR, 0, 0, Constants.BUILDING_LABEL_HEIGHT);
        } else {
            this.name = null;
        }
        park = new Plane(context, 2, 2, w, h);
        this.x = x;
        this.z = z;
        this.w = w;
        this.h = h;
    }

    float[] scratchM = new float[16];
    float[] translationM = new float[16];
    void draw(float[] vpMatrix) {
        Matrix.setIdentityM(translationM, 0);
        Matrix.translateM(translationM, 0, x, 0, z);
        Matrix.multiplyMM(scratchM, 0, vpMatrix, 0, translationM, 0);

        park.draw(scratchM, Constants.WATER_COLOR, Constants.FOG_COLOR);

        if (name != null) {
            Matrix.setIdentityM(translationM, 0);
            Matrix.translateM(translationM, 0, x + w / 2 - name.getWidth() / 2, 0, z + h / 2 - name.getHeight() / 2);
            Matrix.multiplyMM(scratchM, 0, vpMatrix, 0, translationM, 0);
            name.draw(scratchM);
        }
    }
}
