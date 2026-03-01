package belringer.maps;

import android.content.Context;
import android.opengl.GLSurfaceView;
import android.util.AttributeSet;

/**
 * Open GL coordinate system is right handed with x pointing right and y pointing up. From an aerial
 * view, this means "north" is -z, and "east" is x.
 * <p>The current location has an (x, z) coordinates, and an angle which indicates the direction
 * the "arrow" is pointing at. The angle is 0 degrees pointing north and 90 degrees pointing east:
 * <pre>
 *                   N (0 degrees)
 *                   |
 * (270 degrees) W -- -- E (90 degrees)
 *                   |
 *                   S (180 degrees)
 * </pre>
 *
 */
public class MapView extends GLSurfaceView {
    private MapRenderer renderer;

    public MapView(Context context, AttributeSet attrs) {
        super(context, attrs);

        setEGLContextClientVersion(2);
        renderer = new MapRenderer(context, this::requestRender);
        setRenderer(renderer);
    }

    public CameraType getCameraType() {
        return renderer.getCameraType();
    }

    public void setCameraType(CameraType cameraType) {
        renderer.setCameraType(cameraType);
    }

    public void moveBy(float dx, float dz) {
        renderer.moveBy(dx, dz);
    }
}