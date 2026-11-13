#include <cregion.h>
#include <general.h>

//-----------------------
// cregion constructor(s) 
//-----------------------
cregion::cregion(int x, int y, int cx, int cy)
{
  resize(x,y,cx,cy);
}

cregion::cregion(void)
{
  resize(0,0,0,0);
}

//----------------------------
// changes region pos and size
//----------------------------
void cregion::resize(int x, int y, int cx, int cy)
{
  this->x = x;
  this->y = y;
  this->cx = cx;
  this->cy = cy;
}

//-----------------------------------------
//  r1 = r2 & r3;
//  r1 equal to the intersection of r2 & r3
//  returns empty region if no intersection 
//------------------------------------------
cregion cregion::operator&(cregion op2)
{
  cregion res(0,0,0,0);

  if (op2.x >= (x + cx) || (op2.x + op2.cx) <= x) return res;
  if (op2.y >= (y + cy) || (op2.y + op2.cy) <= y) return res;

  int maxx1 = max(op2.x, x);
  int minx1 = min(op2.x, x);
  int maxx2 = max(op2.x+op2.cx-1, x+cx-1);
  int minx2 = min(op2.x+op2.cx-1, x+cx-1);
  int maxy1 = max(op2.y, y);
  int miny1 = min(op2.y, y);
  int maxy2 = max(op2.y+op2.cy-1, y+cy-1);
  int miny2 = min(op2.y+op2.cy-1, y+cy-1);

  res.x = maxx1;
  res.y = maxy1;
  res.cx = minx2-maxx1+1;
  res.cy = miny2-maxy1+1;
  return res;
}

//------------------------------------------------------
// returns if point with coors (x,y) is into this region
//------------------------------------------------------
int cregion::inregion(int x, int y)
{
  return (x>=this->x && y>=this->y && 
          x<=this->x+this->cx-1 && y<=this->y+this->cy);
}

///////////////////////////////
// non-member funcs definition
///////////////////////////////
