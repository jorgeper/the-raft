package belringer.maps;

import android.graphics.Color;

class Constants {
    static final Color ROAD_TEXT_COLOR = Color.valueOf(0xff616161); //0xff939b9e); //0xff616161);
    static final Color BUILDING_TEXT_COLOR = Color.valueOf(0xffa1a1a1);
    static final Color BUILDING_TEXT_COLOR_SPECIAL = Color.valueOf(0xffdc9877);
    static final Color WATER_COLOR = Color.valueOf(0xffaadaff);
    static final Color WATER_TEXT_COLOR = Color.valueOf(0xff5286c9);
    static final Color PARK_TEXT_COLOR = Color.valueOf(0xff4d811f); //0xff7cb57b); //0xff4d811f);
    static final Color GROUND_COLOR = Color.valueOf(0xfffefdf7); //0xfff6f7f8); //0xfffefdf7);
    static final Color FOG_COLOR = Color.valueOf(0x00000000); //0xff82d5d9);
    static final Color ROAD_COLOR = Color.valueOf(0xffdad9d3); //0xffffffff); //0xffdad9d3);
    static final Color BUILDING_COLOR = Color.valueOf(0xffefece7);
    static final Color BUILDING_COLOR_SPECIAL = Color.valueOf(0xfff5f3e4); //0xfffdf8f1); //0xffef0000);
    static final Color PARK_COLOR = Color.valueOf(0xffc5e8c5); //0xffc6ebb5);
    static final float CITY_BLOCK_WIDTH = 2;
    static final float ROAD_WIDTH =0.25f;
    static final float SIDEWALK_WIDTH =0.2f;
    static final float ROAD_LABEL_HEIGHT=0.6f;
    static final float BUILDING_LABEL_HEIGHT=0.7f;
    static final float GROUND_WIDTH = 1000.f;
    static final float CHASE_CAMERA_DISTANCE_FROM_LOCATION = 6.0f;
    static final float CHASE_CAMERA_HEIGHT = 6.0f;
    static final float AERIAL_CAMERA_HEIGHT = 23.f;

    // Location halo animation constants.
    static final int HALO_PULSE_PERIOD = 2000; // 2 seconds per full pulse
    static final float HALO_PULSE_RANGE = 0.10f; // contract and expand by 0.15% per period.
}
