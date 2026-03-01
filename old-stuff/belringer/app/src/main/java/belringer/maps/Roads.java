package belringer.maps;

import android.content.Context;
import android.graphics.Color;
import android.opengl.Matrix;

import java.util.ArrayList;
import java.util.List;

class Roads {
    private static final float DISTANCE_BETWEEN_LABELS = 8.f;
    private static final float LABEL_OFFSET = 2.f;

    private final Color streetColor;
    private Color fogColor;

    private final List<Plane> streets;
    private final List<Text> streetNames;

    private final List<Plane> avenues;
    private final List<Text> avenueNames;

    Roads(Context context, Color streetColor, Color fogColor, CityModel city) {
        streets = new ArrayList<>();
        streetNames = new ArrayList<>();
        for (int i = 0; i < CityModel.STREET_COUNT; ++i) {
            Plane street = new Plane(context, 2, 2, CityModel.STREET_LENGTH, Constants.ROAD_WIDTH);
            streets.add(street);
            Text name = new Text(context, city.getStreetName(i), Constants.ROAD_TEXT_COLOR,
                    0,
                    (i * CityModel.AVENUE_BLOCK_HEIGHT) - (Constants.ROAD_LABEL_HEIGHT) / 2.f,
                    Constants.ROAD_LABEL_HEIGHT);
            streetNames.add(name);
        }

        avenues = new ArrayList<>();
        avenueNames = new ArrayList<>();
        for (int i = 0; i < CityModel.AVENUE_COUNT; ++i) {
            Plane street = new Plane(context, 2, 2, Constants.ROAD_WIDTH, CityModel.AVENUE_LENGTH);
            avenues.add(street);
            Text name = new Text(context, city.getAvenueName(i), Constants.ROAD_TEXT_COLOR,
                    (i * CityModel.STREET_BLOCK_WIDTH) - (Constants.ROAD_LABEL_HEIGHT) / 2.f,
                    0,
                    Constants.ROAD_LABEL_HEIGHT);
            avenueNames.add(name);
        }

        this.streetColor = streetColor;
        this.fogColor = fogColor;
    }

    void draw(float[] vPMatrix, Color fogColor) {
        this.fogColor = fogColor;
        float[] scratchM = new float[16];
        float[] translationM = new float[16];
        float[] translationIM = new float[16];
        float[] rotationM = new float[16];

        for (int i = 0; i < streets.size(); ++i) {
            Matrix.setIdentityM(translationM, 0);
            Matrix.translateM(translationM, 0,
                    0,
                    0,
                    i * CityModel.AVENUE_BLOCK_HEIGHT - Constants.ROAD_WIDTH /2.f);

            Matrix.multiplyMM(scratchM, 0, vPMatrix, 0, translationM, 0);
            streets.get(i).draw(scratchM, streetColor, Constants.FOG_COLOR);
        }

        for (int i = 0; i < avenues.size(); ++i) {
            Matrix.setIdentityM(translationM, 0);
            Matrix.translateM(translationM, 0,
                    i * CityModel.STREET_BLOCK_WIDTH - Constants.ROAD_WIDTH /2.f,
                    0,
                    0);

            Matrix.multiplyMM(scratchM, 0, vPMatrix, 0, translationM, 0);
            avenues.get(i).draw(scratchM, streetColor, Constants.FOG_COLOR);
        }

        for (int i = 0; i < streetNames.size(); ++i) {
            float d = 0.f;
            while (d < CityModel.STREET_LENGTH) {
                Matrix.setIdentityM(translationM, 0);
                Matrix.translateM(translationM, 0, LABEL_OFFSET + d,  0, 0);
                Matrix.multiplyMM(scratchM, 0, vPMatrix, 0, translationM, 0);
                streetNames.get(i).draw(scratchM);
                d += DISTANCE_BETWEEN_LABELS;
            }
        }

        for (int i = 0; i < avenues.size(); ++i) {
            float d = 0.f;
            while (d < CityModel.AVENUE_LENGTH) {
                Text name = avenueNames.get(i);

                Matrix.setIdentityM(translationM, 0);
                Matrix.translateM(translationM, 0, -name.getX(),  0, -name.getZ());
                Matrix.setRotateM(rotationM, 0, 90, 0, 1.f, 0.f);
                Matrix.setIdentityM(translationIM, 0);
                Matrix.translateM(translationIM, 0, name.getX(),  0, name.getZ());

                Matrix.multiplyMM(scratchM, 0, rotationM, 0, translationM, 0);
                Matrix.multiplyMM(scratchM, 0, translationIM, 0, scratchM, 0);

                // Now move to the bottom of the avenue so we start south->north.
                Matrix.setIdentityM(translationM, 0);
                Matrix.translateM(translationM, 0, 0,  0, CityModel.AVENUE_LENGTH);
                Matrix.multiplyMM(scratchM, 0, translationM, 0, scratchM, 0);

                Matrix.setIdentityM(translationM, 0);
                Matrix.translateM(translationM, 0, 0,  0, -LABEL_OFFSET - d);
                Matrix.multiplyMM(scratchM, 0, translationM, 0, scratchM, 0);

                Matrix.multiplyMM(scratchM, 0, vPMatrix, 0, scratchM, 0);

                name.draw(scratchM);
                d += DISTANCE_BETWEEN_LABELS;
            }
        }
    }
}
