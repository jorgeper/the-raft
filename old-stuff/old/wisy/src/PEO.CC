#include <dos.h>
#include <stdlib.h>
#include <stdio.h>
#include <time.h>
#include <grx.h>

int main(int argc, char *argv[])
{
  if (argc != 2) return 0;

  GrSetMode(GR_width_height_color_graphics, 640, 480, 256);  
  
  GrSetFontPath("c:\\lab\\wisy\\fonts");
  GrFont *font = GrLoadFont(argv[1]);
  
  GrTextOption opt;
  opt.txo_font = font;
  opt.txo_xmag = opt.txo_ymag = 1;
  opt.txo_fgcolor.v = 15;
  opt.txo_bgcolor.v = 0;
  opt.txo_direct = 0;
  opt.txo_xalign = GR_ALIGN_LEFT;
  opt.txo_yalign = GR_ALIGN_CENTER;
  opt.txo_chrtype = GR_BYTE_TEXT;

  GrDrawString("Jorge Pereira y Pedreira WISY (c)", 15, 10,10,&opt);
  while(!kbhit());
  GrSetMode(GR_default_text);
}

