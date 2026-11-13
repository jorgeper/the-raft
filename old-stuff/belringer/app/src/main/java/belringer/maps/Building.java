package belringer.maps;

import android.content.Context;
import android.graphics.Color;
import android.opengl.Matrix;

public class Building {
    private final Plane building;
    private final Text name;
    private final float x;
    private final float z;
    private final float w;
    private final float h;
    private final Color color;

    Building(Context context, String name, float x, float z, float w, float h) {
        this(context, name, x, z, w, h, Constants.BUILDING_COLOR);
    }

    Building(Context context, String name, float x, float z, float w, float h, Color color) {
        if (name != null) {
            this.name = new Text(context, name, Constants.BUILDING_TEXT_COLOR, 0, 0, Constants.BUILDING_LABEL_HEIGHT);
        } else {
            this.name = null;
        }
        building = new Plane(context, 2, 2, w, h);
        this.x = x;
        this.z = z;
        this.w = w;
        this.h = h;
        this.color = color;
    }

    void draw(float[] vpMatrix) {
        float[] scratchM = new float[16];
        float[] translationM = new float[16];
        Matrix.setIdentityM(translationM, 0);
        Matrix.translateM(translationM, 0, x, 0, z);
        Matrix.multiplyMM(scratchM, 0, vpMatrix, 0, translationM, 0);

        building.draw(scratchM, color, Constants.FOG_COLOR);

        if (name != null) {
            Matrix.setIdentityM(translationM, 0);
            Matrix.translateM(translationM, 0, x + w / 2 - name.getWidth() / 2, 0, z + h / 2 - name.getHeight() / 2);
            Matrix.multiplyMM(scratchM, 0, vpMatrix, 0, translationM, 0);
            name.draw(scratchM);
        }
    }
}
