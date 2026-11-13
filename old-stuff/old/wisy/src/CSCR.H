#ifndef _CSCR_H_
#define _CSCR_H_

#include <stdio.h>
#include <crect.h>
#include <cbuffer.h>
#include <cregion.h>
#include <clist.h>
#include <font.h>

#define DEF_MAINRECT_COLOR      8

  // exceptions
#define EX_NOTHING              1
#define EX_WIN_DESTROY          2

#define FONT_PATH       "c:\\lab\\wisy\\fonts"
#define SYSTEM_FONT     "xm8x16b.fnt"
#define SF_H            16
#define SF_W            8

///////////////////////////////////////
// cscr: screen basic windowing system
///////////////////////////////////////
class cscr
{
  // internal stuff
  public:
    int cx, cy, numcol;
    crect *mainrect;             // main rectangle  
    char    child_intersection;   // perform child intersection?
    char    kill_children_too;    
    char    directmove;
    crect  *bully;               // bully rect
    
    clist   *fontlist;           //font list

    int     ex;                 // exception
    crect  *prex;               // what rect?

  // internal funcs
  public:
    clist   *compactintlist (clist *intlist);
    clist   *getintlist     (crect *pr, cregion *prg);
    clist   *getrglist      (crect *pr, cregion *prg);
    crect   *getdestrect    (MouseEvent *event);
   
  //////////////////////// interface ////////////////////////
  public:
    
    // general
    int      init        (int cx, int cy, int numcol, cregion *mr);
    int      init        (int cx, int cy, int numcol, int rx, int ry, int rcx, int rcy); 
    void     close       (void);
    int      run         (void);
    void     setbully    (crect *pr)  {bully = pr;}
    void     clearbully  (void)       {bully = NULL;}
    void     setmouseregion (cregion *prg);

    // rects
    crect   *getrect     (int x, int y, int cx, int cy, crect *parent, int color=-1);
    crect   *getrect     (cregion *prg, crect *parent, int color=-1);
    void     destroyrect (crect *rect);
    void     clear       (crect *pr);
    int      resize      (crect *pr, cregion *prg);
    int      tofront     (crect *pr);
    void     hiderect    (crect *pr);
    void     showrect    (crect *pr, int clear);
    int      activerect  (crect *pr);           // this is boolean!
    void     exception   (int ex, crect *prex);
    void     doexception (void);

    // buffers
    cbuffer *getbuf      (crect *pr, cregion *prg);
    void     destroybuf  (cbuffer *buf);

    // fonts
    void loadfont   (char *name, char *desc); 
    void unloadfont (char *name);
    font *getfont   (char *name);
};


#endif
