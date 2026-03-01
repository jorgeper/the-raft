#ifndef _CRECT_H_
#define _CRECT_H_

#include <clist.h>
#include <cregion.h>
#include <cmsg.h>

#define DEF_RECT_COLOR          8

class cscr;

///////////////////////////////
//  crect: main cscr item (?) 
//  NOTES:
///////////////////////////////
class crect
{
  // internal stuff
  public:
    clist   *rlist;             // rect list
    cregion *region;            // region mapped to parent 
    crect   *parent;            // parent ptr
    int      color;
    cscr    *s;                 // this is set by cscr::getrect()
    int      active;    
    
  public:
           crect (int x, int y, int cx, int cy);
          ~crect (void);
    crect *add   (crect *pr);
    void   del   (crect *pr);
    
    clist *getrplist(cregion *r1, cregion *r2);
    void  resizeevent(cpaintmsg *msg);
    void  rectproc(cmsg *msg);
    void  (*objproc)(cmsg *msg, void *objdata);
    void  (*userproc)(cmsg *msg, void *objdata);
    void  *objdata;
};

////////////////////////////////
// non-member funcs declaration
////////////////////////////////
int      rgintersect   (cregion *r1, cregion *r2);
int      rginto        (cregion *r1, cregion *r2);

void     rgtoscr       (crect *pr, cregion *prg);
void     rgclip        (crect *pr, cregion *prg);
void     rgscrclip     (crect *pr, cregion *prg);
cregion *rgsize        (crect *pr, cregion *prg);
void     rgpoint       (crect *pr, int *x, int *y);
void     rgtoparent    (crect *pr, cregion *prg);

#endif


  // this objproc does nothing
void def_objproc(cmsg *msg, void *objdata);    // defaulf nextproc


