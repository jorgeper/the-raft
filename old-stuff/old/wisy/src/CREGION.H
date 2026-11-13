#ifndef _CREGION_H_
#define _CREGION_H_

#include <general.h>

////////////////////////////////////////////
// cregion: rectangular region somewhere
// NOTES:
//    1. a region is empty if cx==0 || cy==0
/////////////////////////////////////////////
class cregion
{
  public:
  int      x, y, cx, cy;

  public:
  int      empty     (void) { return ((cx==0) || (cy==0)); }
  cregion  operator& (cregion op2);
  int      inregion  (int x, int y);
  void     resize    (int x, int y, int cx, int cy);
           cregion   (int x, int y, int cx, int cy);
           cregion   (void);
};

////////////////////////////////////
// non-member functions declaration
////////////////////////////////////


#endif
