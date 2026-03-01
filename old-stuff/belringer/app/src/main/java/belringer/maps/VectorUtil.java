package belringer.maps;

/** Terrible quickly thrown together vector math utilities. */
public class VectorUtil {
    private static final float EPSILON = 0.0000001f;

    public static String toString(float[] v) {
        return "[" + v[0] + ", " + v[1] + ", " + v[2] + "]";
    }

    public static float[] cross(float[] a, float[] b, float[] res) {
        res[0] = a[1] * b[2] - b[1] * a[2];
        res[1] = a[2] * b[0] - b[2] * a[0];
        res[2] = a[0] * b[1] - b[0] * a[1];
        return res;
    }

    public static float[] sub(float[] a, float[] b, float[] res) {
        res[0] = a[0] - b[0];
        res[1] = a[1] - b[1];
        res[2] = a[2] - b[2];
        return res;
    }

    public static float[] add(float[] a, float[] b, float[] res) {
        res[0] = a[0] + b[0];
        res[1] = a[1] + b[1];
        res[2] = a[2] + b[2];
        return res;
    }

    public static boolean equals(float a, float b) {
        return Math.abs(a - b) <= EPSILON;
    }

    public static boolean equals(float[] a, float[] b, int numDim) {
        boolean returnValue = true;
        for (int i = 0; i < numDim; ++i) {
            returnValue &= equals(a[i], b[i]);
        }
        return returnValue;
    }

    public static boolean equals(float[] a, float[] b) {
        return equals(a, b, 3);
    }

    public static float length(float[] a) {
        return (float) Math.sqrt(a[0]*a[0] + a[1]*a[1] + a[2]*a[2]);
    }

    public static float distance(float[] a, float[] b) {
        return length(sub(a, b, new float[3]));
    }

    public static float[] norm(float[] a, float[] res) {
        float len = length(a);
        return div(a, len, res);
    }


    public static float[] div(float[] a, float d, float[] res) {
        res[0] = a[0] / d;
        res[1] = a[1] / d;
        res[2] = a[2] / d;
        return res;
    }

    public static float[] mul(float[] a, float m, float[] res) {
        res[0] = a[0] * m;
        res[1] = a[1] * m;
        res[2] = a[2] * m;
        return res;
    }

    public static float lerp(float a, float b, float x) {
        if (a < b) {
            return Math.min(a + x, b);
        } else {
            return Math.max(a - x, b);
        }
    }

    public static float[] set(float[] a, float[] b) {
        a[0] = b[0];
        a[1] = b[1];
        a[2] = b[2];
        return a;
    }

    public static float[] set(float[] a, float x, float y, float z) {
        a[0] = x;
        a[1] = y;
        a[2] = z;
        return a;
    }

    public static float[] lerp(float[] a, float[] b, float x, float[] res) {
        float[] sub = sub(b, a, new float[3]);
        float len = length(sub);
        if (x >= len) {
            return mul(b, 1, res);
        } else if (x <= 0) {
            return mul(a, 1, res);
        } else {
            return add(a, mul(div(sub, len, new float[3]), x, res), res);
        }
    }
}
