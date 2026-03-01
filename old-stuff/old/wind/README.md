# WIND

A text-mode windowing system written in Turbo C, dated August 23, 1995.

It runs on a standard DOS 80x25 text screen and draws windows using CP437 box-drawing characters. Windows can be dragged by their title bars, resized from the borders, closed, and maximized. Each window supports horizontal and vertical scrollbars and casts a drop shadow on the desktop beneath it.

The original source code is in `src/` (WIN6C.C for the main program and TVIEWS.C/H for the screen buffer layer). Open `demo.html` in a browser to try a JavaScript cross-compilation that renders the text cells onto an HTML canvas.
