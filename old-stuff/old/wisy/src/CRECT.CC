#include <cregion.h>
#include <crect.h>
#include <stdio.h>
#include <clist.h>
#include <cbuffer.h>
#include <cscr.h>

#include <random.h>
#include <window.h>

#define DIRECT(s, r)    ((r)->parent == (s)->mainrect && (crect *)((s)->mainrect->rlist->start->info) == (r))

//////////////////////////////////
// NON MEMBER FUNCTION DEFINITION
//////////////////////////////////

void rgpoint(crect *pr, int *x, int *y)
{
  crect *pr2;

  for (pr2 = pr; pr2; pr2 = pr2->parent)
        {
        (*x) -= pr2->region->x;
        (*y) -= pr2->region->y;
        }
}

//------------------------------------------------------                                                        
// returns if the intersection between r1 & r2 is empty
//------------------------------------------------------
int rgintersect(cregion *r1, cregion *r2)
{
  return !((r1->x > r2->x+r2->cx) || (r2->x > r1->x+r1->cx) ||
          (r1->y > r2->y+r2->cy) || (r2->y > r1->y+r1->cy));
}

//------------------------------
// returns true if r1 is into r2
//------------------------------
int rginto(cregion *r1, cregion *r2)
{
  return ((r1->x >= r2->x) && (r1->x+r1->cx <= r2->x+r2->cx) &&
          (r1->y >= r2->y) && (r1->y+r1->cy <= r2->y+r2->cy));
}

//------------------------------------------------------
// returns a region (0,0,pr->region,cx, prg->region->cy
// it's usefull for getting entire rect area buffers
//------------------------------------------------------
cregion *rgsize(crect *pr, cregion *prg)
{
  prg->x = prg->y = 0;
  prg->cx = pr->region->cx;
  prg->cy = pr->region->cy;
  return prg;
}

//-------------------------------------------
// returns *prg position in screen
// NOTE: *prg is a subregion in this->region 
//-------------------------------------------
void rgtoscr(crect *pr, cregion *prg)
{
  crect *pr2;

  for (pr2 = pr; pr2; pr2 = pr2->parent)
        {
        prg->x += pr2->region->x;
        prg->y += pr2->region->y;
        }
}

//-------------------------------------------
// clips *prg to *pr
// NOTE: *prg is a subregion in *pr 
//-------------------------------------------
void rgclip(crect *pr, cregion *prg)
{
  if (prg->x >= pr->region->cx || prg->y >= pr->region->cy ||
      prg->x + prg->cx <= 0 || prg->y + prg->cy <= 0)
        {
        prg->cx = prg->cy = 0;
        return;
        }
  if (prg->x < 0) {prg->cx += prg->x; prg->x = 0;} 
  if (prg->y < 0) {prg->cy += prg->y; prg->y = 0;}
  if (prg->x+prg->cx > pr->region->cx) prg->cx = pr->region->cx - prg->x;
  if (prg->y+prg->cy > pr->region->cy) prg->cy = pr->region->cy - prg->y;
  return;
}

//--------------------------------------------------------------------
// returns the region in screen corresponding to the prg region in pr
//--------------------------------------------------------------------
void rgscrclip(crect *pr, cregion *prg)
{
  crect *temp;
  int i=0;
  for (temp = pr; temp; temp = temp->parent)
        {
        rgclip(temp, prg);
        if (prg->empty()) return;
        prg->x += temp->region->x;
        prg->y += temp->region->y;
        }
}

void rgtoparent(crect *pr, cregion *prg)
{
  if (!pr->parent) return;
  prg->x += pr->parent->region->x;
  prg->y += pr->parent->region->y;
}

/////////////////////
// MEMBER FUNCTIONS
/////////////////////

//-------------------
// crect constructor
//-------------------
crect::crect(int x, int y, int cx, int cy)
{
  active = 0;
  rlist = new clist;
  region = new cregion (x, y, cx, cy);
  parent = NULL;
  objproc = def_objproc;
  color = DEF_RECT_COLOR;
  userproc = NULL;
}

//------------------
// crect destructor
//------------------
crect::~crect(void) 
{ 
  delete region; 
  delete rlist;  
}

//--------------------
// adds a child rect
//--------------------
crect *crect::add(crect *pr)
{
  clnode *np;
  for (np=rlist->start; np && (crect *)np->info != pr; np=np->next)
        ;
  if (np) return NULL;
  pr->parent = this;
  return (crect *)rlist->push(pr);
}

//----------------------
// deletes a child rect
//----------------------
void crect::del(crect *pr)
{
  clnode *np;
  np = rlist->nth(pr);
  if (!np) return;
  rlist->del(np);
}

/////////////////////////////////////////////////
void def_objproc(cmsg *msg, void *objdata)
{
  return;
}

//----------------------------------------------------------------------
// gets the repaint list
// NOTES:
//   returns the repaint list when resizing the region r1 to become r2.
//   both regions must be mapped to this rect.
//   returns a list of regions mapped to this rect too
//----------------------------------------------------------------------
clist *crect::getrplist(cregion *r1, cregion *r2)
{
  cregion *temp;
  clist *rplist = new clist;
  
    // intrg <- intersection between r1 & r2
  cregion intrg = (*r1) & (*r2);
 
    // if no intersection, returns a list with only r1 
  if (intrg.empty())
        {
        temp = new cregion;
        *temp = *r1;
        rplist->push(temp);
        return rplist;
        }

    // if no emtpy inters...
  else
        {
        if (intrg.y > r1->y)
                {
                temp = new cregion 
                        (r1->x, r1->y, r1->cx, intrg.y-r1->y);
                        rplist->append(temp);
                }
                
        if (intrg.y+intrg.cy < r1->y+r1->cy)
                {
                temp = new cregion 
                        (r1->x, intrg.y+intrg.cy, r1->cx, 
                         r1->y+r1->cy-intrg.y-intrg.cy);
                        rplist->append(temp);
                }
                
        if (intrg.x > r1->x)
                {
                temp = new cregion 
                        (r1->x, intrg.y, intrg.x-r1->x, intrg.cy);
                        rplist->append(temp);
                }

        if (intrg.x+intrg.cx < r1->x+r1->cx)
                {
                temp = new cregion 
                        (intrg.x+intrg.cx, intrg.y, 
                        r1->x+r1->cx-intrg.x-intrg.cx, intrg.cy);
                        rplist->append(temp);
                }
        return rplist;
        }
  
  return NULL;
}


//=========================
// general rect procedure
//=========================
void crect::rectproc(cmsg *msg)
{
  cpaintmsg *submsg = (cpaintmsg *)msg;
  cpaintmsg nmsg;
  clnode *np;

  switch(msg->id)
        {
        case (MSG_RESIZE):
                
                if (objproc != NULL) objproc(msg, this->objdata);
                
                  // saves the old and the new regions
                cregion oldreg, newreg;
                oldreg = *(this->region);
                
                  // resizes the rect
                s->resize(this, &(submsg->region));
                newreg = *(this->region);
                
                  // sends a paint msg for the new region
                  // can perform a direct context movement?
                        
                cregion scrreg(0,0,s->cx, s->cy);

                if (s->directmove && 
                    DIRECT(s, this) && 
                    rginto(&oldreg, &scrreg) &&
                    rginto(&newreg, &scrreg) &&
                    newreg.cx == oldreg.cx && 
                    newreg.cy == oldreg.cy)
                        {
                        moveregion(&oldreg, &newreg);
                        }

                  // if cannot directly move it...
                else
                        {
                        rgsize(this, &(nmsg.region));
                        rectproc(&nmsg);
                        }

                  //redraws the background
                if (parent)
                        {
                          // for every brother...
                        clist *rplist = parent->getrplist(&oldreg, &newreg);
                        if (!rplist) break;
                        for (np=rplist->start; np; np=np->next)
                                {
                                nmsg.region = *((cregion *)(np->info));       
                                
                                rgclip(parent, &(nmsg.region));
                                if (!nmsg.region.empty())
                                        parent->rectproc(&nmsg);
                                
                                delete (cregion *)(np->info);
                                }
                        if (rplist) delete(rplist);
                        }

                  // sends the msg to the child
                if (objproc != NULL) objproc(msg, this->objdata);

                break;
        
        case (MSG_PAINT):                   
                s->child_intersection = 1;
                crect *child;

                  // this msg is first send to the objprocedure of this rect 
                if (objproc != NULL) objproc(submsg, this->objdata);

                  // and then to every children
                for (np=rlist->start; np ; np=np->next)
                        {
                        child = (crect *)(np->info);
                        if (child->active)
                        {

                          // gets inters between child reg and paint reg
                        nmsg.region = (*(child->region)) & submsg->region;  
                        
                          // maps the interst to the child region
                        nmsg.region.x -= child->region->x;
                        nmsg.region.y -= child->region->y;

                          // if not empty...
                        if (!nmsg.region.empty())
                                ((crect *)(np->info))->rectproc(&nmsg);
                        } // end if "child->active"...
                        }
                s->child_intersection = 0;
                break;
        
        case MSG_HIDE:
                s->hiderect(this);                
                
                  // sends a repaint msg to the parent
                nmsg.id = MSG_PAINT;
                nmsg.region = *(this->region);
                rgclip(parent, &(nmsg.region));
                if (!nmsg.region.empty())
                        parent->rectproc(&nmsg);
                
                  // sends the msg to the child
                if (objproc != NULL) objproc(msg, this->objdata);
                break;

        default:
                  // an unknown msg is passed to the objprocedure
                if (objproc != NULL) objproc(msg, this->objdata);
                break;
        };
}
