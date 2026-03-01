package belringer.maps;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

import android.content.Context;
import android.graphics.Color;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.opengl.Matrix;
import android.os.SystemClock;

import static android.opengl.GLES20.GL_BLEND;
import static android.opengl.GLES20.GL_CULL_FACE;
import static android.opengl.GLES20.GL_DEPTH_TEST;
import static android.opengl.GLES20.GL_ONE_MINUS_SRC_ALPHA;
import static android.opengl.GLES20.GL_SRC_ALPHA;
import static android.opengl.GLES20.glBlendFunc;
import static android.opengl.GLES20.glDisable;
import static android.opengl.GLES20.glEnable;
import static belringer.maps.Constants.GROUND_WIDTH;

public class MapRenderer implements GLSurfaceView.Renderer {
    private final float[] pMatrix = new float[16];
    private final float[] vMatrix = new float[16];
    private final float[] vpMatrix = new float[16];
    private final Context context;

    private float nextX;
    private float nextZ;

    private Camera camera;
    private Grid grid;
    private Axes axes;
    private Plane ground;
    private Roads roads;
    private Location location;
    private Text cityName;
    private CityModel city;
    private Building ozgesPalace;
    private Park centralPark;
    private Park lakeSheetPark;
    private Water lakeSheet;
    private CityBlock testCityBlock;
    private long time;
    private MapRendererListener listener;
    private CameraType cameraType = CameraType.AERIAL;
    private boolean isDirty = true;
    private CityBlocks cityBlocks;
    private Line line;

    MapRenderer(Context context, MapRendererListener listener) {
        this.context = context;
        this.listener = listener;
    }

    CameraType getCameraType() {
        return cameraType;
    }

    void setCameraType(CameraType cameraType) {
        this.cameraType = cameraType;
        camera.lookAt(location.getPosition(), location.getDirection(), cameraType, true);
    }

    static int loadShader(int type, String shaderCode) {
        int shader = GLES20.glCreateShader(type);

        // add the source code to the shader and compile it
        GLES20.glShaderSource(shader, shaderCode);
        GLES20.glCompileShader(shader);

        return shader;
    }

    public void onSurfaceCreated(GL10 unused, EGLConfig config) {
        time = SystemClock.uptimeMillis();

        line = new Line(context);

        city = new CityModel();
        city.setStreetName(0, "Pereira");
        city.setStreetName(1, "Lima");
        city.setStreetName(5, "Morning Roll");
        city.setStreetName(6, "Nutella Fiesta");

        // Debugging aids.
        axes = new Axes(context);
        grid = new Grid(context, 1000, 1);

        testCityBlock = new CityBlock(context, 4, 6,city);

        centralPark = new Park(context, "Central Park",
                city.withSidewalk(city.avenueX(5)),
                city.withSidewalk(city.streetZ(4)),
                city.streetBlockWidth(),
                city.avenueBlockHeight());

        lakeSheetPark = new Park(context, null,
                city.withSidewalk(city.avenueX(8)),
                city.withSidewalk(city.streetZ(3)),
                city.streetBlockWidth(),
                city.avenueBlockHeight());

        float parkOffset = 0.f; //0.25f;
        lakeSheet = new Water(context, "Sheet Lake",
                city.withSidewalk(city.avenueX(8)) + parkOffset,
                city.withSidewalk(city.streetZ(3)) + parkOffset,
                city.streetBlockWidth() - parkOffset * 2,
                city.avenueBlockHeight() - parkOffset * 2);

        ozgesPalace = new Building(context,"Ozge's Palace",
                city.withSidewalk(city.avenueX(5)),
                city.withSidewalk(city.streetZ(5)),
                city.streetBlockWidth(),
                city.avenueBlockHeight());

        cityBlocks = new CityBlocks(context, city);
        cityBlocks.addSpecial("City Hall", 5,6,0.8f, 0.5f);

        camera = new Camera(time, 0.f, 0.f, 0.f);

        // The ground is a big 1000x1000 quad.
        ground = new Plane(context, 2, 2, GROUND_WIDTH, GROUND_WIDTH);

        roads = new Roads(context, Constants.ROAD_COLOR, Constants.FOG_COLOR, city);
        location = new Location(context);

        // Start at the corner of the city, looking north.
        nextX = city.streetZ(6);
        nextZ = city.avenueX(6);
//        nextX = city.streetZ(1);
//        nextZ = city.avenueX(1);
        location.moveTo(nextX, nextZ, false);
        location.setAngle(0, false);
        cityName = new Text(context, "Welcome to Werevra", Constants.ROAD_TEXT_COLOR, 0, -1, 0.5f);
        camera.lookAt(location.getPosition(), location.getDirection(), cameraType, false);

        location.setListener(() -> {
            // TODO: if animating camera, don't chase location
            camera.lookAt(location.getPosition(), location.getDirection(), cameraType, false);
            listener.onDirty();
        });

        glDisable(GL_DEPTH_TEST);
        glDisable(GL_CULL_FACE);
        glEnable(GL_BLEND);
        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA); // for blending location sprite

        listener.onDirty();
    }

    boolean tick() {
        time = SystemClock.elapsedRealtime();
        boolean returnValue = isDirty;
        returnValue |= location.tick(time);
        returnValue |= camera.tick(time);

        // TODO: this should be calculated from all children, but for now this is good enough.
        isDirty = false;
        return returnValue;
    }

    public void onDrawFrame(GL10 unused) {
        // TODO: actually do make use of the dirty flag.
        // We currently render the entire scene in every frame in the render loop regardless of
        // whether things changed or not.
        tick();

        // Calculate the view projection matrix.
        camera.set(vMatrix);
        Matrix.multiplyMM(vpMatrix, 0, pMatrix, 0, vMatrix, 0);

//        float[] vpMatrixI = new float[16];
//        float[] vMatrixI = new float[16];
//        float[] pMatrixI = new float[16];
//
//        Matrix.invertM(vMatrixI, 0, vMatrix, 0);
//        Matrix.invertM(pMatrixI, 0, pMatrix, 0);
//        Matrix.multiplyMM(vpMatrixI, 0, vMatrixI, 0, pMatrixI, 0);

        // Translate the ground so that it is centered around the origin.
        float[] translationM = new float[16];
        Matrix.setIdentityM(translationM, 0);
        Matrix.translateM(translationM, 0, -GROUND_WIDTH / 2, 0, -GROUND_WIDTH / 2);
        float[] groundM = new float[16];
        Matrix.multiplyMM(groundM, 0, vpMatrix, 0, translationM, 0);

        // For aerial camera, disable fog effect, since that's based on distance to the camera, not
        // strictly based on the horizon.
        // TODO: use a nice fading animation for the fog density.
        Color fogColor = Constants.FOG_COLOR;
        if (cameraType == CameraType.AERIAL) {
            fogColor = Color.valueOf(Color.TRANSPARENT);;
        }

        // Clear up the frame, using the sky color. We'll start laying out the rest of the layers
        // on top.
        GLES20.glClearColor(0.507f, 0.83f, 0.84f, 1.0f);
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);
        ground.draw(groundM, Constants.GROUND_COLOR, fogColor);
        roads.draw(vpMatrix, fogColor);
        location.draw(vpMatrix);

        //cityName.draw(vpMatrix);

        cityBlocks.draw(vpMatrix);
        centralPark.draw(vpMatrix);
        //lakeSheetPark.draw(vpMatrix);
        lakeSheet.draw(vpMatrix);
        ozgesPalace.draw(vpMatrix);
        //testCityBlock.draw(vpMatrix);
        location.draw(vpMatrix);

        // Debugging aids.
        //grid.draw(vpMatrix, fogColor);
        //line.draw(vpMatrix, Color.valueOf(0xffff0000), ress);
//        axes.draw(vpMatrix);
    }

    // WIP: convert screen coordinates to world coordinates
    public void screenToWorld() {
        float[] scratch = new float[16];
        Matrix.invertM(scratch, 0, vpMatrix, 0);

        float[] vec = new float[] { -1.f, -1.f, -1.f, 1.f};
        float[] res = new float[4];
        Matrix.multiplyMV(res, 0, scratch, 0, vec, 0);

        float[] vec2 = new float[] { 1.f, 1.f, -1.f, 1.f};
        float[] res2 = new float[4];
        Matrix.multiplyMV(res2, 0, scratch, 0, vec2, 0);

        float[] ress = new float[] {res[0] / res[3], res[1]/ res[3], res[2]/ res[3], res2[0]/ res2[3], res2[1]/ res2[3], res2[2]/ res2[3]};

        // TODO: this world but gives a point at a random altitude (y)
        // if I want to force y to ground level, how to do it ?
    }

    public void onSurfaceChanged(GL10 unused, int width, int height) {
        GLES20.glViewport(0, 0, width, height);
        float ratio = (float) width / height;
        Matrix.frustumM(pMatrix, 0, -ratio, ratio, -1, 1, 2, 100);
    }

    void moveBy(float dx, float dz) {
        nextX = nextX + dx;
        nextZ = nextZ + dz;
        moveTo(nextX, nextZ);
    }

    void moveTo(float x, float z) {
        location.moveTo(x, z, true);
    }
}