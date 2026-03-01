package belringer.maps;

import android.content.Context;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Objects;

class CityBlocks {
    private final List<CityBlock> blocks = new ArrayList<>();
    private final HashMap<Integer, CityBlock> blockMap = new HashMap<>();

    CityBlocks(Context context, CityModel city) {
        for (int i = 0; i < CityModel.AVENUE_COUNT; ++i) {
            for (int j = 0; j < CityModel.STREET_COUNT - 1; ++j) {
                CityBlock block = new CityBlock(context, i + 1, j + 1, city);
                blocks.add(block);
                blockMap.put(getKey(i, j), block);
            }
        }
    }

    CityBlock getBlock(int i, int j) {
        return blockMap.get(getKey(i, j));
    }

    void addSpecial(String name, int street, int avenue, float wp, float hp) {
        CityBlock block = getBlock(avenue, street);
        block.addSpecial(name, street, avenue, wp, hp);
    }

    private int getKey(int i, int j) {
        return Objects.hash(i, j);
    }

    void draw(float[] vPMatrix) {
        for (CityBlock block : blocks) {
            block.draw(vPMatrix);
        }
    }
}
