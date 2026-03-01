package belringer.maps;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.opengl.Matrix;

class Text {
    private static final int TEXT_SIZE_PX = 32;

    private final Bitmap bmp;
    private final TexturedQuad cityName;
    final float[] transformM = new float[16];
    private final float x;
    private final float z;
    private final float width;
    private final float height;

    public Text(Context context, String text, Color color, float x, float z, float fontHeight) {
        bmp = Text.drawText(text, color);
        cityName = new TexturedQuad(context, bmp);
        float aspect = ((float) bmp.getWidth()) / bmp.getHeight();
        width = aspect * fontHeight;
        height = fontHeight;
        float[] scaleM = new float[16];
        Matrix.setIdentityM(scaleM, 0);
        Matrix.scaleM(scaleM, 0, width, 1.f, fontHeight);
        float[] translationM = new float[16];
        Matrix.setIdentityM(translationM, 0);
        Matrix.translateM(translationM, 0, x, 0, z);
        Matrix.multiplyMM(transformM, 0, translationM, 0, scaleM, 0);
        this.x = x;
        this.z = z;
    }

    float getWidth() {
        return width;
    }

    float getHeight() {
        return height;
    }

    float getX() {
        return x;
    }

    float getZ() {
        return z;
    }

    public void draw(float[] vpMatrix) {
        float[] scratch = new float[16];
        Matrix.multiplyMM(scratch, 0, vpMatrix, 0, transformM, 0);
        cityName.draw(scratch);
    }

    static Bitmap drawText (String text, Color color){
        Paint textPaint = new Paint();
        textPaint.setTextAlign(Paint.Align.LEFT);
        textPaint.setTextSize(TEXT_SIZE_PX);
        textPaint.setAntiAlias(true);
        textPaint.setColor(color.toArgb());
        Rect bounds = new Rect();
        textPaint.getTextBounds(text, 0, text.length(), bounds);
        int textWidth = bounds.width();

        Paint.FontMetrics fm = textPaint.getFontMetrics();
        int textHeight = (int) (-fm.top + fm.bottom);

        Bitmap bitmap = Bitmap.createBitmap(textWidth, textHeight, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        bitmap.eraseColor(Color.TRANSPARENT);

        canvas.drawText(text, 0, -fm.ascent, textPaint);

        return bitmap;
    }
}
