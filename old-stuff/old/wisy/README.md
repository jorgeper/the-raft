# WISY

A graphical windowing system written in C++ for DOS, circa 1996. It uses the GRX graphics library to draw at 800x600 resolution.

The system implements a small widget toolkit with 3D-bordered windows, title bars, close and maximize buttons, resizable borders, and client areas that can host child controls like buttons. Windows support drag-to-move, border-drag-to-resize, maximize/restore, and an animated zoom effect on open and close.

The included demo app ("Generador de lineas aleatorias 1.0") creates several windows and lets you draw random lines by clicking a button.

The original source code is in `src/` -- the main classes are CREGION (regions), CRECT (rectangles/widget tree), CSCR (screen/event loop), WINDOW (window widget), and BUTTON (button widget). Open `demo.html` in a browser to try a JavaScript cross-compilation that replaces the GRX drawing primitives with HTML canvas calls.
