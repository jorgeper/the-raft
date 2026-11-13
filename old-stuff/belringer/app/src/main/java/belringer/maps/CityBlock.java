package belringer.maps;

import android.content.Context;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Random;

class CityBlock {
    private class BuildingSpec {
        float x;
        float z;
        float w;
        float h;
        int i;
        int j;
        boolean coalescedNorth;
        boolean coalescedWest;

        boolean isSpecial;

        // Percentages of block length, for special buildings only.
        float wp;
        float hp;
        String name;
    }

    private final List<Building> buildings;
    private final Random rand = new Random();
    private final HashMap<Integer, BuildingSpec> specs = new HashMap<>();
    private final Context context;
    private final CityModel city;

    CityBlock(Context context, int street, int avenue, CityModel city) {
        this.context = context;
        this.city = city;

        buildings = new ArrayList<>();

        int buildindsPerBlockStreet = Math.max(4, rand.nextInt(CityModel.BUILDINGS_PER_BLOCK_STREET + 1));
        int buildingsPerBlockAvenue = Math.max(4, rand.nextInt(CityModel.BUILDINGS_PER_BLOCK_AVENUE + 1));

        float maxBuildingWidth;
        float maxBuildingHeight = (city.avenueBlockHeight() / buildingsPerBlockAvenue) - CityModel.BUILDING_ALLEY_WIDTH;

        float halfRoad = Constants.ROAD_WIDTH / 2.f;
        float z = city.streetZ(street) + halfRoad + Constants.SIDEWALK_WIDTH;
        for (int i = 0; i < buildingsPerBlockAvenue; ++i) {
            buildindsPerBlockStreet = Math.max(4, rand.nextInt(CityModel.BUILDINGS_PER_BLOCK_STREET + 1));
            maxBuildingWidth = (city.streetBlockWidth() / buildindsPerBlockStreet) - CityModel.BUILDING_ALLEY_WIDTH;
            float x = city.avenueX(avenue) + halfRoad + Constants.SIDEWALK_WIDTH;

            boolean doInterior = rand.nextBoolean();
            int interiorBuildings = 0;
            for (int j = 0; j < buildindsPerBlockStreet; ++j) {
                if (interiorBuildings < 1) {
                    doInterior = rand.nextBoolean();
                    if (doInterior) {
                        interiorBuildings++;
                    }
                } else {
                    doInterior = false;

                }
                if (doInterior ||
                        (j == 0 || j == buildindsPerBlockStreet - 1) || (
                        (i == 0 || i == buildingsPerBlockAvenue - 1))) {
                     BuildingSpec spec = new BuildingSpec();
                    spec.x = x;
                    spec.z = z;
                    spec.w = maxBuildingWidth;
                    spec.h = maxBuildingHeight;
                    spec.i = i;
                    spec.j = j;
                    addSpec(i, j, spec);
                }
                x += maxBuildingWidth + CityModel.BUILDING_ALLEY_WIDTH;
            }
            z += maxBuildingHeight+ CityModel.BUILDING_ALLEY_WIDTH;
        }

        List<BuildingSpec> coalesced = new ArrayList<>();
        coalesceNorthSouth(coalesced);
        coalesceWestEast(coalesced);
        for (BuildingSpec spec : coalesced) {
            specs.remove(Objects.hash(spec.i, spec.j));
        }

        refresh();
    }

    void refresh() {
        buildings.clear();
        for (Map.Entry<Integer, BuildingSpec> entry : specs.entrySet()) {
            BuildingSpec spec = entry.getValue();
            float rd1 = spec.isSpecial ? 0 : rand.nextFloat() * 0.2f;
            float rd2 = spec.isSpecial ? 0 : rand.nextFloat() * 0.2f;
            float rd3 = spec.isSpecial ? 0 : rand.nextFloat() * 0.21f;
            float rd4 = spec.isSpecial ? 0 : rand.nextFloat() * 0.2f;

            Building building = new Building(context, spec.name,
                    spec.x + rd1,
                    spec.z + rd2,
                    spec.w - rd1 - rd3,
                    spec.h - rd2 - rd4,
                    spec.isSpecial ? Constants.BUILDING_COLOR_SPECIAL : Constants.BUILDING_COLOR);
            buildings.add(building);
        }

    }

    void addSpecial(String name, int street, int avenue, float wp, float hp) {
        float offset = Constants.ROAD_WIDTH / 2 + Constants.SIDEWALK_WIDTH;
        BuildingSpec spec = new BuildingSpec();
        spec.i = avenue;
        spec.j = street;
        spec.h = CityModel.AVENUE_BLOCK_HEIGHT * hp - offset * 2;
        spec.w = CityModel.STREET_BLOCK_WIDTH* wp - offset * 2;
        spec.wp = wp;
        spec.hp = hp;
        spec.isSpecial = true;
        spec.name = name;

        // Special buildings are always first in the block
        // TODO: change this.
        spec.x = city.avenueX(avenue) + offset;
        spec.z = city.streetZ(street) + offset;

        addSpec(spec.i, spec.j, spec);
        refresh();
    }

    private void coalesceWestEast(List<BuildingSpec> coalesced) {
        for (Map.Entry<Integer, BuildingSpec> entry : specs.entrySet()) {
            BuildingSpec spec = entry.getValue();
            BuildingSpec westSpec = getSpec(spec.i, spec.j - 1);
            boolean coalesceWest = westSpec != null && rand.nextBoolean() && !westSpec.coalescedWest && !westSpec.coalescedNorth;

            if (coalesceWest) {
                westSpec.w += spec.w;
                westSpec.h = Math.max(westSpec.h, spec.h);
                spec.coalescedWest = true;
                coalesced.add(spec);
            }
        }
    }

    private void coalesceNorthSouth(List<BuildingSpec> coalesced) {
        int count = 0;
        for (Map.Entry<Integer, BuildingSpec> entry : specs.entrySet()) {
            if (count == 2) {
                break;
            }
            BuildingSpec spec = entry.getValue();
            BuildingSpec northSpec = getSpec(spec.i - 1, spec.j);
            boolean coalesceNorth = northSpec != null && rand.nextBoolean() && !northSpec.coalescedWest && !northSpec.coalescedNorth;

            if (coalesceNorth) {
                count++;
                northSpec.h += spec.h;
                northSpec.w = Math.max(northSpec.w, spec.w);
                spec.coalescedNorth = true;
                coalesced.add(spec);
            }
        }
    }

    private void addSpec(int i, int j, BuildingSpec spec) {
        specs.put(Objects.hash(i, j), spec);
    }

    private BuildingSpec getSpec(int i, int j) {
        return specs.get(Objects.hash(i, j));
    }

    private float getRandom(float maxSize, float maxDelta) {
        return maxSize - maxDelta * rand.nextFloat();
    }

    void draw(float[] vPMatrix) {
        for (Building building : buildings) {
            building.draw(vPMatrix);
        }
    }
}
