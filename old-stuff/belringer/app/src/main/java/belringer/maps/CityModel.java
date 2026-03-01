package belringer.maps;

import android.util.SparseArray;

class CityModel {
    static final int AVENUE_COUNT = 11;
    static final int STREET_COUNT = 11;
    static final float STREET_LENGTH = 40;
    static final float AVENUE_LENGTH = 50;
    static final float AVENUE_BLOCK_HEIGHT = CityModel.AVENUE_LENGTH / (CityModel.STREET_COUNT - 1);
    static final float STREET_BLOCK_WIDTH = CityModel.STREET_LENGTH / (CityModel.AVENUE_COUNT - 1);
    static final float[] CITY_CENTER = new float[] { STREET_LENGTH / 2, AVENUE_LENGTH / 2};
    static final int BUILDINGS_PER_BLOCK_STREET = 3; // 1..3
    static final int BUILDINGS_PER_BLOCK_AVENUE = 4; // 1..4
    static final float BUILDING_ALLEY_WIDTH = 0.05f;

    private final SparseArray<String> streets = new SparseArray<>();
    private final SparseArray<String> avenues = new SparseArray<>();

    void setStreetName(int num, String name) {
        streets.put(num  - 1, name);
    }

    void setAvenueName(int num, String name) {
        avenues.put(num - 1, name);
    }

    float avenueBlockHeight() {
        return AVENUE_BLOCK_HEIGHT - Constants.SIDEWALK_WIDTH * 2 - Constants.ROAD_WIDTH;
    }

    float streetBlockWidth() {
        return STREET_BLOCK_WIDTH - Constants.SIDEWALK_WIDTH * 2 - Constants.ROAD_WIDTH;
    }

    float withSidewalk(float f) {
        return f + Constants.ROAD_WIDTH / 2 + Constants.SIDEWALK_WIDTH;
    }


    float streetZ(int num) {
        return (num - 1) * AVENUE_BLOCK_HEIGHT;
    }

    float avenueX(int num) {
        return (num - 1) * STREET_BLOCK_WIDTH;
    }

    String getStreetName(int num) {
        String name = streets.get(num);
        if (name == null) {
            num++;
            String suffix = num == 1 ? "st" : num == 2 ? "nd" : num == 3 ? "rd" : "th";
            name = num + suffix;
        }
        return name + " st";
    }

    String getAvenueName(int num) {
        String name = avenues.get(num);
        if (name == null) {
            num++;
            String suffix = num == 1 ? "st" : num == 2 ? "nd" : num == 3 ? "rd" : "th";
            name = num + suffix;
        }
        return name + " ave";
    }
}
