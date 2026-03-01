#include <cbuffer.h>
#include <crect.h>
#include <cregion.h>
#include <grx.h>
#include <stdio.h>
#include <general.h>

#include <font.h>

//--------------------
// cbuffer destructor
//--------------------
cbuffer::~cbuffer(void)
{
  clnode *np;
  delete prg; 
     
  if (this->empty) return;

  for (np=rglist->start; np; np=np->next)
	{
	delete (cregion *)(np->info);
	}
  delete rglist; 
  GrDestroyContext(context); 
}


////////////////////
//  FX PRIMITIVES
////////////////////

#define FXBOX_COLOR     8


//----------------------------------------------------------
// creates a direct or indirect (dir) buffer and returns it
//----------------------------------------------------------
GrContext *createcontext(cregion *prg, int dir)
{
    // if direct buffer...
  if (dir)
	   return GrCreateSubContext(prg->x, prg->y, prg->x+prg->cx-1,
				     prg->y+prg->cy-1, NULL, NULL);
  else
	   return GrCreateContext(prg->cx, prg->cy, NULL, NULL);
}

///////////////////////////////////////////////////////////
// macro to make the conversion from libx functions to
// cbuffer drawing primitives
// NOTE: maps to the rect (not the buffer)
///////////////////////////////////////////////////////////
#define DRAWING_PRIMITIVE_BODY(libxfunc) {if(this->empty) return;\
	GrSetContext(this->context);\
	int i=0;\
	clnode *np;\
	cregion *prg2;\
	for (np=rglist->start; np; np=np->next) {\
		i++;\
		prg2=(cregion *)(np->info);\
		GrSetClipBox(prg2->x, prg2->y, prg2->x+prg2->cx-1, prg2->y+prg2->cy-1);\
		(libxfunc);\
		} GrSetContext(NULL);} 

/////////////////////////////////
// drawing primitives definition
/////////////////////////////////
//------------------------------------------------------------
void cbuffer::clear(int col)
{
  filledbox(0, 0, prg->cx, prg->cy, col);
}
//------------------------------------------------------------
void cbuffer::filledbox(int x1, int y1, int x2, int y2, int col)
DRAWING_PRIMITIVE_BODY(GrFilledBox(x1-prg->x+negx, y1-prg->y+negy, x2-prg->x+negx, y2-prg->y+negy, col))
  
  // just a little overhead...
void cbuffer::filledbox(cregion *region, int col)
{
  filledbox(region->x, region->y, region->x+region->cx-1, region->y+region->cy-1,col);
} 

//---------------------------------------------------------
void cbuffer::line(int x1, int y1, int x2, int y2, int col)
DRAWING_PRIMITIVE_BODY(GrLine(x1-prg->x+negx, y1-prg->y+negy, x2-prg->x+negx, y2-prg->y+negy, col))
//---------------------------------------------------------
void cbuffer::plot(int x, int y, int col)
DRAWING_PRIMITIVE_BODY(GrUsrPlot(x, y, col))
//---------------------------------------------------------
void cbuffer::box(int x1, int y1, int x2, int y2, int col)
DRAWING_PRIMITIVE_BODY(GrBox(x1-prg->x+negx, y1-prg->y+negy, x2-prg->x+negx, y2-prg->y+negy, col))

//-----------------
// draws a xor box
//-----------------
void fxbox(int x, int y, int cx, int cy)
{
  GrBox(x, y, x+cx-1, y+cy-1, GrXOR | FXBOX_COLOR);
  GrBox(x+1, y+1, x+cx-2, y+cy-2, GrXOR | FXBOX_COLOR);
  //GrBox(x+2, y+2, x+cx-3, y+cy-3, GrXOR | FXBOX_COLOR);
}

//-------------------------------------
// THIS IS NOT A GRX FUNCTION: (fxbox)
//-------------------------------------
void cbuffer::xorbox(int x, int y, int cx, int cy)
DRAWING_PRIMITIVE_BODY(fxbox(x-prg->x+negx, y-prg->y+negy, cx, cy));

  // just a little overhead...
void cbuffer::xorbox(cregion *region)
{
  xorbox(region->x, region->y, region->cx, region->cy);
} 

//-----------------
// draws a 3d box
//-----------------
void fxbox3d(int x1, int y1, int x2, int y2, struct fx *pfx)
{
  if (!pfx) return;
  GrLine(x1,y1,x1,y2,pfx->c2);
  GrLine(x1,y1,x2,y1,pfx->c1);
  GrLine(x2,y1,x2,y2,pfx->c3);
  GrLine(x1,y2,x2,y2,pfx->c4);
  
  if (pfx->width == 2)
	{
	GrLine(x1+1,y1+1,x1+1,y2-1,pfx->c2);
	GrLine(x1+1,y1+1,x2-1,y1+1,pfx->c1);
	GrLine(x2-1,y1+1,x2-1,y2-1,pfx->c3);
	GrLine(x1+1,y2-1,x2-1,y2-1,pfx->c4);
	}
}

//-------------------------------------
// THIS IS NOT A GRX FUNCTION: (fxbox3d)
//-------------------------------------
void cbuffer::box3d(int x1, int y1, int x2, int y2, struct fx *pfx)
DRAWING_PRIMITIVE_BODY(fxbox3d(x1-prg->x+negx, y1-prg->y+negy, x2-prg->x+negx, y2-prg->y+negy, pfx));

//------------------------------------
// draws a xor box going from r1 to r2
//------------------------------------
void cbuffer::zoombox(cregion *r1, cregion *r2)
{
  int dx, dy, dcx, dcy;
  
  dx = (r2->x - r1->x) / ZOOM_STEPS;
  dy = (r2->y - r1->y) / ZOOM_STEPS;
  dcx = (r2->cx - r1->cx) / ZOOM_STEPS;
  dcy = (r2->cy - r1->cy) / ZOOM_STEPS;

  cregion temp = *r1;
  int i, j;
  
  xorbox(&temp);
  for (i=0; i<ZOOM_STEPS; i++)
	{
	xorbox(&temp);
	for (j=0; j<1000;j++); //delay

	temp.x += dx;
	temp.y += dy;
	temp.cx += dcx;
	temp.cy += dcy;
	xorbox(&temp);
	}
	xorbox(&temp);
}

//------------------------------------------------------
// moves a rectangle from r1 to r2 (in the whole screen)
//------------------------------------------------------
void moveregion(cregion *r1, cregion *r2)
{
  GrContext *c1 = createcontext(r1, 1);  
  GrContext *c2 = createcontext(r2, 1);

  if (!c1 || !c2) return;

 // GrSetContext(c2);
  GrBitBlt(c2, 0,0, c1, 0,0,r1->cx-1,r1->cy-1, GrWRITE);
  
  GrDestroyContext(c1);
  GrDestroyContext(c2);
}
     
//--------------
// draws a font
//--------------
void cbuffer::textxy(char *text, int x, int y, int fcolor, int bcolor, font *pfont)
{
  if (!pfont || !text) return;

  GrTextOption opt;
  
  opt.txo_font = pfont->f;
  opt.txo_xmag = opt.txo_ymag = 1;
  opt.txo_fgcolor.v = fcolor;
  opt.txo_bgcolor.v = bcolor;
  opt.txo_direct = 0;
  opt.txo_xalign = GR_ALIGN_LEFT;
  opt.txo_yalign = GR_ALIGN_TOP;
  opt.txo_chrtype = GR_BYTE_TEXT;

  drawstring(text, strlen(text), x, y, &opt); 
}


//---------------------------------------------------------
void cbuffer::drawstring(char *text, int length, int x, int y, GrTextOption *opt)
DRAWING_PRIMITIVE_BODY(GrDrawString(text, length, x-prg->x+negx, y-prg->y+negy, opt))

