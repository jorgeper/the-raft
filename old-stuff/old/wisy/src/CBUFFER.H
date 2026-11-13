#ifndef _CBUFFER_H_
#define _CBUFFER_H_

#include <cregion.h>
#include <grx.h>
#include <clist.h>
#include <font.h>

  // number of xor boxes to draw with cbuffer::zoombox()
#define ZOOM_STEPS      20

class cscr;
class crect;

struct fx
{
  int width;
  int c1, c2, c3, c4;
};

//////////////////////////////////////
// cbuffer: basic screen buffers
//////////////////////////////////////
class cbuffer
{
  public:
    int       empty;
    clist     *rglist;
    GrContext *context;
    cregion   *prg;             // region passed as parameter in getbuffer
    crect     *pr;              // owner rect
    int       negx, negy;       // patch! (when the context have neg coors) 
    int       negcx, negcy;

  // internal
  public:
     cbuffer(void) {negcx = negcy = negx = negy = 0; prg = NULL; rglist = NULL; pr = NULL; context = NULL; }
    ~cbuffer(void);
     
  // interface
  public:
     void filledbox (int x1, int y1, int x2, int y2, int col);
     void filledbox (cregion *region, int col);
     void box       (int x1, int y1, int x2, int y2, int col);
     void line      (int x1, int y1, int x2, int y2, int col);
     void plot      (int x, int y, int col);
     void xorbox    (int x, int y, int cx, int cy);
     void xorbox    (cregion *region);
     void box3d     (int x1, int y1, int x2, int y2, struct fx *pfx);
     void clear     (int col);
     void zoombox   (cregion *r1, cregion *r2);
     void drawstring(char *text, int length, int x, int y, GrTextOption *opt);
     void textxy    (char *text, int x, int y, int fcolor, int bcolor, font *pfont);
};

//-----------------------------------
// non-member functions declarations
//-----------------------------------
GrContext *createcontext(cregion *prg, int dir);
void moveregion(cregion *r1, cregion *r2);
#endif

