#include <wisy.h>

//////////////////////////////
//        INTERNAL          
//////////////////////////////

//-------------------------------------------------------------------------
// compacts intersection list
// (for each pair of regions (r1, r2) in the list checks if r1 is into r2
// NOTE: I think is not much efficient to use this by now...maybe in next
// versions will be more usefull
//-------------------------------------------------------------------------
clist *cscr::compactintlist(clist *intlist)
{
  clnode *np, *np2;
  clnode *nextn;

  for (np=intlist->start; np; np=np->next)
        {
        for (np2=np->next; np2; np2=nextn)
                {
                nextn = np2->next;
                if (rginto((cregion *)np2->info, (cregion *)np->info)) 
                        intlist.del(np2);
                }
        }
  return intlist;
}         

//---------------------------------------------------
// Gets intersection list for the region prg into pr
//---------------------------------------------------
clist *cscr::getintlist (crect *pr, cregion *prg)
{
  clnode *np;
  cregion *intrg, temp = *prg;
  clist *intlist = new clist;
  crect *parent = pr->parent;
  
    // is the region visible in the rect?
  rgclip(pr, &temp);
  if (temp.empty()) return intlist;
  
if (child_intersection)    
        {
          // gets intersection list with `child rects'
        for (np=pr->rlist->start; np; np=np->next)
                {
                  // if the rect is active
                if ( ((crect *)np->info)->active )    
                        {
                        intrg = new cregion;
                        *intrg = *(((crect *)np->info)->region) & temp;
          
                          // gets intersect region in screen coordinates
                        if (!intrg->empty()) rgscrclip(pr, intrg);

                          // if not empty, then add it to the intersect list
                        if (!intrg->empty()) intlist->push(intrg);
                        else delete intrg;
                        }
                }       
        }

    // does the same for the brother rects (if it's no mainrect)
  crect *dest = pr;
  while (parent)
        {   
          // temp <- region at parent level
        temp.x+=dest->region->x;
        temp.y+=dest->region->y;

          // gets intersection list with `brother rects'
          // note only previous rect nodes in the node list are considered
        for (np=parent->rlist->start; np && (crect *)(np->info)!=dest; np=np->next)
                {
                  // if the rect is active
                if ( ((crect *)np->info)->active )    
                        {
                        intrg = new cregion;
                        *intrg = *(((crect *)np->info)->region) & temp;
                        if (!intrg->empty()) rgscrclip(parent, intrg);
                        if (!intrg->empty()) intlist->push(intrg);
                        else delete intrg;
                        }
                }
                dest=parent;
                parent=parent->parent;
        }

  // compactintlist(intlist);         NO THANKS (read this function comments)
  return intlist;                   
}                                                         

// -------------------------------------------------------
// gets the region list for the region prg in the rect pr
// the regions returned are mapped to the screen
// -------------------------------------------------------
clist *cscr::getrglist (crect *pr, cregion *prg)
{
  cregion *temp = new cregion;
  *temp = *prg;

    // strange safety copy ;)
  cregion *orig = new cregion;
  *orig = *temp;    
  
    // temp mapped to screen
  rgscrclip(pr, temp);
    
    // empty region?
  if (temp->empty()) { delete temp; return NULL; }
    
    // gets intersection list
  clist *intlist = getintlist(pr, prg);
  clist *rglist = new clist; 
  
    // here starts the main part of the algorithm <--------------
  rglist->push(temp);

    // temp vars used by the algorithm
  cregion *mskrg, *srcrg, *newrg, temprg;
  int length;
  clnode *np, *np2;
  
  for (np=intlist->start; np; np=np->next)
        {
        mskrg = (cregion *)(np->info);
        length = rglist->length;
        while (length--)
                {
                srcrg = (cregion *)rglist->pop(); 
                
                temprg = (*mskrg) & (*srcrg); 
                if (temprg.empty())
                        {
                        newrg = new cregion;
                        (*newrg) = (*srcrg);
                        rglist->append(newrg);
                        delete srcrg;
                        continue;
                        }

                if (temprg.y > srcrg->y)
                        {
                        newrg = new cregion 
                        (srcrg->x, srcrg->y, srcrg->cx, temprg.y-srcrg->y);
                        rglist->append(newrg);
                        }
                
                if (temprg.y+temprg.cy < srcrg->y+srcrg->cy)
                        {
                        newrg = new cregion 
                        (srcrg->x, temprg.y+temprg.cy, srcrg->cx, 
                         srcrg->y+srcrg->cy-temprg.y-temprg.cy/*+1*/);
                        rglist->append(newrg);
                        }
                
                if (temprg.x > srcrg->x)
                        {
                        newrg = new cregion 
                        (srcrg->x, temprg.y, temprg.x-srcrg->x, temprg.cy);
                        rglist->append(newrg);
                        }

                if (temprg.x+temprg.cx < srcrg->x+srcrg->cx)
                        {
                        newrg = new cregion 
                        (temprg.x+temprg.cx, temprg.y, 
                        srcrg->x+srcrg->cx-temprg.x-temprg.cx/*+1*/, temprg.cy);
                        rglist->append(newrg);
                        }
                }
                delete srcrg;
        }

    // deletes unnecessary mem
  delete intlist;
  delete orig;
  return rglist;        // (the list is mapped to screen)
}


//////////////////////////////
//        BUFFERS            
//////////////////////////////

//------------------------------------------------------
// gets a buffer in the region *prg at the rect *pr
//------------------------------------------------------
cbuffer *cscr::getbuf(crect *pr, cregion *prg)
{
  cbuffer *buffer = new cbuffer;
  cregion temp = *prg;
    
    // init buffer vars */
  buffer->prg = new cregion;
  *(buffer->prg) = *prg;
  buffer->pr = pr;              // (owner)
  buffer->empty = 1;
  if (!pr->active) return buffer;
    
    // init rglist
  buffer->rglist = getrglist(pr, &temp);

    // is visible this region ?
  rgscrclip(pr, &temp);
  if (temp.empty()) return buffer;
   
  buffer->empty=0;

    // get temp clipped to pr
  temp = *prg;
  rgclip(pr, &temp);

    // creates a context in the temp region (mapped and clipped to screen)
  rgtoscr(pr, &temp);
  if (temp.x < 0)
        {
        buffer->negx = temp.x;
        temp.cx += (temp.x);
        temp.x = 0;
        }
  if (temp.y < 0)
        {
        buffer->negy = temp.y;
        temp.cy += temp.y;
        temp.y = 0;
        }
  
  /*if (temp.x + temp.cx >= this->cx)
        {
        buffer->negcx = temp.cx + temp.x - this->cx;
        temp.cx = this->cx - temp.x;
        }
  if (temp.y + temp.cy >= this->cy)
        {
        buffer->negcy = temp.cy + temp.y  - this->cy;
        temp.cy = this->cy - temp.y;
        }
  */

  if (temp.cx <= 0 || temp.cy <= 0) 
        {
        buffer->empty = 1;
        return buffer;
        }
  
  buffer->context = createcontext(&temp, 1);
   
    // gets rglist coordinates mapped to the context
  for (clnode *np=buffer->rglist->start; np; np=np->next)
        {
          ((cregion *)(np->info))->x -= temp.x;
          ((cregion *)(np->info))->y -= temp.y;
        }

  return buffer;
}

//-------------------
// destroys a buffer
//-------------------
void cscr::destroybuf(cbuffer *buf)
{
  if (buf) delete buf;
}

/////////////////////////
//       RECTS          
/////////////////////////

//-----------------------------------------------------
// resizes a rect (and adjusts the buffers in all scr)
//-----------------------------------------------------
int cscr::resize(crect *pr, cregion *prg)
{
  *(pr->region) = *prg;
  return 0;
}

//----------------------------
// brings a rect to the front
//----------------------------
int cscr::tofront(crect *pr)
{
  if (pr == mainrect) return 0;
  
    // gets the first rect in the list st
  crect *st = (crect *)(pr->parent->rlist->start->info);

    // if is the first yet exit
  if (st == pr) return 0;

    // gets the node in the parent's list
  clnode *np;
  clist *rlist = pr->parent->rlist;
  if ((np = rlist->nth(pr)) == NULL) return -1;
  
    // changes the position in the list 
  crect *temp;
  temp = (crect *)(np->info);
  rlist->del(np);
  rlist->push(temp);
 
    // sends a paint msg
  cpaintmsg msg;

  rgsize(pr, &(msg.region));
  pr->rectproc(&msg);
  
  return 0;
}

//-----------------------------------------------------------
// is the rect shown? (active)
// NOTE:
// a child rect can be active but not shown if the parent is 
// inactive  
// ANY RECT DRAWING PRIMITIVE SHOULD CHECK THIS FUNCTION
//-----------------------------------------------------------
int cscr::activerect(crect *pr)
{
  crect *temp = pr;
  while (temp)
        {
        if (!temp->active) return 0;
        temp=temp->parent;
        }
  return 1;
}

//--------------------------------------
// clears the rect surface in it's color
//--------------------------------------
void cscr::clear(crect *pr)
{
  if (!activerect(pr)) return;
  
  cregion temp;
  cbuffer *buf = getbuf(pr, rgsize(pr, &temp));
  buf->filledbox(0,0,temp.cx,temp.cy, pr->color);
  destroybuf(buf);
}

//-------------------------
// gets a rect from the scr
//-------------------------
crect *cscr::getrect(int x, int y, int cx, int cy, crect *parent, int color=-1)
{
  crect *pr = new crect (x, y, cx, cy);

    // adds the rect to the parent list
  if (!parent) mainrect->add(pr);
  else parent->add(pr);

    // sets the properties
  if (color != -1) pr->color = color;
  pr->s = this;
  pr->active = 0;               // initialy inactive...
       
    // sends the rect a create msg
  cmsg msg (MSG_CREATE);
  pr->rectproc(&msg);

  return pr;
}

//-----------------------
// gets a rect version 2
//-----------------------
crect *cscr::getrect(cregion *prg, crect *parent, int color=-1)
{
  return getrect(prg->x, prg->y, prg->cx, prg->cy, parent, color);
}


///////////////////////////////////////////
// recursive aux function for destroyrect
///////////////////////////////////////////
void destroychildrect(cscr *s, crect *child)
{
  crect *newchild;
  while (!child->rlist->empty())
        {
        newchild = (crect *)(child->rlist->pop());
        destroychildrect(s, newchild);
        }

    // if have too destroy child rect...
  if (s->kill_children_too) delete child;
}

//----------------------------------------
// destroys a rect gotten with getrect
// NOTE: the children rects can:
//   - get without parent
//   - be killed
// depending on the kill_children_too flag
// in the cscr object
//----------------------------------------
void cscr::destroyrect(crect *pr)
{
    // exit if...
  if (pr == mainrect) return;
  if (!pr) return;

    // destroys recursively the children
  crect *parent = pr->parent;
  crect *child;
  while (!pr->rlist->empty())
        {
        child = (crect *)(pr->rlist->pop());
        destroychildrect(this, child);
        }

  parent->del(pr);
  delete pr;
  return;
}

