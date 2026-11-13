#ifndef _WINDOW_H_
#define _WINDOW_H_

#include <wisy.h>

  // tama¤o m ximo del t¡tulo de la ventana
#define MAX_WND_TITLE           100

#define DEF_CLIENT_COLOR        15
#define BORDER_W                4
#define TITLE_H                 18
#define CORNER_W                20

#define MIN_WINDOW_W            100
#define MIN_WINDOW_H            40

  // flags for storing temp information
#define FLG_MOVING      1
#define FLG_LEFT_DOWN   2
#define FLG_TITLE       4
#define FLG_LB          8       // left border
#define FLG_RB         16       // right border
#define FLG_TB         32       // top border
#define FLG_BB         64       // bottom border
#define FLG_WNDMAX    128       // is the window maximized?         
 
  // default id
#define IAMNOBODY       1234

typedef struct
{
  int      id;
  cscr    *s;
  crect   *r;
  char     flags;
  char     props;
  int      ttlcolor;
  cregion  movrg;
  int      movx, movy;
  cbuffer *movbuf;
  char     title[MAX_WND_TITLE];

  crect   *bclose;
  crect   *bsize;
  crect   *client;

  cregion sizereg;

    // font stuff
  GrTextOption opt;
  GrFont      *font;
  int         fgcol ,bgcol;

}wnddata;

typedef struct
{
  int      id;
  cscr    *s;
  crect   *r;
  char     props;
}cldata;

  // flags for properties setting
#define FP_TOFRONT      1
#define FP_SIZE         2
#define FP_MOVE         4
#define FP_ZOOMBOX      8  
#define FP_KILL         16
#define FP_TITLE        32

  // flags for client properties (clprops)
#define FP_3DBORDER     1
#define FP_CLEAR        2

class wndprop
{
  public:
    int      id;
    cregion  region;  
    void   (*userproc)(cmsg msg, void *objdata);
    crect   *parent;
    int      ttlcolor;
    int      clcolor;
    char     props;
    char     clprops;
    char     title[MAX_WND_TITLE];
  public:

      // default properties
    wndprop(void)
        {
        region.resize(10,10,100,100);
        userproc = NULL;
        parent = NULL;
        ttlcolor = 1;
        props = FP_TOFRONT;
        clcolor = 7;
        clprops = FP_CLEAR;
        id = IAMNOBODY;
        }
};

crect  *getwindow     (cscr *s, wndprop *prop);
void    destroywindow (cscr *s, crect *pw);

#endif
