package belringer.maps;

import android.content.Context;
import android.graphics.Color;
import android.opengl.Matrix;
import android.os.SystemClock;

import com.example.opengltest.R;

class Location {
    private static final float ANGLE_SPEED = 180.f; // degrees/second
    private static final float SPEED = 1.f; // units/second
    private static final float HALF_WIDTH = 0.5f;
    private final TexturedQuad iconQuad;
    private final TexturedQuad haloQuad;
    private final Line directionLine;

    private float[] position = new float[3]; // y always 0
    private float[] nextPos = new float[3];
    private float angle;
    private float nextAngle;
    private float[] direction = new float[3];
    private LocationListener listener;

    Location(Context context) {
        iconQuad = new TexturedQuad(context, R.drawable.location_icon);
        haloQuad = new TexturedQuad(context, R.drawable.location_halo);
        directionLine = new Line(context);
    }

    float[] getPosition() {
        return position;
    }

    float getAngle() {
        return angle;
    }

    /** Returns the direction vector, normalized. */
    float[] getDirection() {
        double cos = Math.cos(Math.toRadians(90 - angle));
        double sin = Math.sin(Math.toRadians(90 - angle));
        direction[0] = (float) cos;
        direction[1] = 0;
        direction[2] = (float) -sin;
        return direction;
    }

    void moveTo(float x, float z, boolean animate) {
        nextPos[0] = x;
        nextPos[1] = 0.f;
        nextPos[2] = z;

        if (!animate) {
            VectorUtil.set(position, nextPos);
        }

        // Normalized next - position vector.
        float[] sub = new float[3];
        VectorUtil.sub(nextPos, position, sub);
        float alpha = (float) Math.toDegrees(Math.atan2(sub[0], -sub[2]));
        setAngle(alpha, animate);

        isDirty = true;
    }

    void setAngle(float angle, boolean animate) {
        nextAngle = angle;
        lastUpdateTime = SystemClock.elapsedRealtime();
        if (!animate) {
            this.angle = nextAngle;
        }
        isDirty = true;
    }

    private void notifyChange() {
        if (listener != null) {
            listener.onLocationChanged();
        }
    }

    private boolean isDirty = true;
    private long lastUpdateTime = 0;

    private float haloScale = 1.0f;

    public boolean tick(long time) {
        if (time <= lastUpdateTime) {
            lastUpdateTime = time;
            return false;
        }

        if (!isDirty) {
            return false;
        }

        float dt = (time - lastUpdateTime) / 1000.f;

        // Animate the scale of the halo.
        float t = (float) (time % Constants.HALO_PULSE_PERIOD);
        // -1 ... 1 in period:
        float sin = (float) Math.sin((float) (t * Math.PI) / (Constants.HALO_PULSE_PERIOD / 2.f));
        haloScale = 1.f + sin * Constants.HALO_PULSE_RANGE;
        boolean isHaloDirty = true;

        // Animate the angle.
        float da = ANGLE_SPEED * dt;
        angle = VectorUtil.lerp(angle, nextAngle, da);

        boolean isAngleDirty = true;
        if (VectorUtil.equals(nextAngle, angle)) {
            angle = nextAngle;
            isAngleDirty = false;
        }

        // Animate the position.
        boolean isPosDirty = true;
        if (!isAngleDirty) {
            float dd = SPEED * dt;
            position = VectorUtil.lerp(position, nextPos, dd, new float[3]);
            if (VectorUtil.equals(nextPos, position, 3)) {
                VectorUtil.set(position, nextPos);
                isPosDirty = false;
            }
        }

        // Notify if the angle or position changed.
        if (isAngleDirty || isPosDirty) {
            notifyChange();
        }

        lastUpdateTime = time;
        isDirty = isAngleDirty || isPosDirty || isHaloDirty;
        return true;
    }

    void draw(float[] mvpMatrix) {
        float[] translation1M = new float[16];
        float[] scratchM = new float[16];
        float[] rotationM = new float[16];
        float[] scaleM = new float[16];
        float[] translation2M = new float[16];

        // Location sprite transform.
        Matrix.setIdentityM(translation1M, 0);
        Matrix.translateM(translation1M, 0, - HALF_WIDTH, 0, -HALF_WIDTH);
        Matrix.setRotateM(rotationM, 0, -angle, 0, 1.f, 0.f);
        Matrix.setIdentityM(translation2M, 0);
        Matrix.translateM(translation2M, 0,  position[0], position[1], position[2]);
        Matrix.multiplyMM(scratchM, 0, rotationM, 0, translation1M, 0);
        Matrix.multiplyMM(scratchM, 0, translation2M, 0, scratchM, 0);
        Matrix.multiplyMM(scratchM, 0, mvpMatrix, 0, scratchM, 0);

        // Location halo transform.
        Matrix.setIdentityM(scaleM, 0);
        Matrix.scaleM(scaleM, 0, haloScale, haloScale, haloScale);

        float[] scratchHaloM = new float[16];
        Matrix.multiplyMM(scratchHaloM, 0, rotationM, 0, translation1M, 0);
        Matrix.multiplyMM(scratchHaloM, 0, scaleM, 0, scratchHaloM, 0);
        Matrix.multiplyMM(scratchHaloM, 0, translation2M, 0, scratchHaloM, 0);
        Matrix.multiplyMM(scratchHaloM, 0, mvpMatrix, 0, scratchHaloM, 0);

        haloQuad.draw(scratchHaloM);
        iconQuad.draw(scratchM);

        // Debugging aid: draw the direction vector.
        float[] dir = getDirection();
        float[] dirLine = new float[] { position[0], position[1], position[2], dir[0] + position[0], dir[1] + position[1], dir[2] + position[2]};
        //directionLine.draw(mvpMatrix, Color.valueOf(0xffff0000), dirLine);
    }

    public void setListener(LocationListener listener) {
        this.listener = listener;
    }

    public interface LocationListener {
        void onLocationChanged();
    }
}

