#include <wisy.h>
#include <window.h>
#include <string.h>

////////////////////
// MAIN RECT STUFF
////////////////////

// main rect data
typedef struct
{
  cscr  *s;
  crect *r;
  int cx, cy;
}mrectdata;

//-------------------
// main rect objproc
//-------------------
void mrectproc(cmsg *msg, void *objdata)
{
  mrectdata *mdp = (mrectdata *)objdata;
  
  switch(msg->id)
        {
        case MSG_PAINT:
                
                        // on a msg_paint redraws all the screen
                cregion temp = (((cpaintmsg *)msg)->region);
                cbuffer *buf = mdp->s->getbuf(mdp->r, &temp);
                buf->filledbox(0,0,mdp->cx-1,mdp->cy-1,mdp->r->color);
                mdp->s->destroybuf(buf);
                break;
        }
}

//------------------------------------------------------
// initializes cscr and screen graphics mode  version 2
//------------------------------------------------------
int cscr::init(int cx, int cy, int numcol, int rx, int ry, int rcx, int rcy) 
{
  cregion temp(rx, ry, rcx, rcy);
  return init(cx, cy, numcol, &temp);
}

//-------------------------------------------
// initializes cscr and screen graphics mode
//-------------------------------------------
int cscr::init(int cx, int cy, int numcol, cregion *mr)
{
    // toggles video mode
  GrSetMode(GR_width_height_color_graphics, cx, cy, numcol);
  GrSetContext(NULL);  
  
    //// properties setup
  this->cx = cx;
  this->cy = cy;
  this->numcol = numcol;
  
    // don't perform child intersection
  this->child_intersection = 0;
  
    // don't kill child rects
  this->kill_children_too = 0;
  
    // don't directly move the windows using bitblt
  this->directmove = 0;
  
    // no bully rect
  this->bully = NULL;
  
  this->fontlist = new clist;

    // exceptions
  this->prex = NULL; 
  this->ex = EX_NOTHING;

    //// creates the mainrect
  mainrect = new crect (0, 0, cx, cy);
  mainrect->parent = NULL;
  mainrect->color = DEF_MAINRECT_COLOR;
  mainrect->s = this;  
  mainrect->active = 1;  
  mainrect->objproc = mrectproc;
  mainrect->objdata = (mrectdata *)malloc(sizeof(mrectdata));
  ((mrectdata *)mainrect->objdata)->cx = cx; 
  ((mrectdata *)mainrect->objdata)->cy = cy;
  ((mrectdata *)mainrect->objdata)->r = mainrect;
  ((mrectdata *)mainrect->objdata)->s = this;

    // if mr, then changes mainrect size
  if (mr) *(mainrect->region) = (*mr);

    // shows the mainrect
  showrect(mainrect, 1);

    //// initializes libgrx event engine
  if (!MouseDetect()) return -1;
  MouseEventMode(1);
  MouseInit();
  MouseEventEnable(1, 1);
  MouseDisplayCursor();
  
    // loads system font
  GrSetFontPath(FONT_PATH);
  loadfont(SYSTEM_FONT, "system");

  return 0;
}

//---------------------
// returns to text mode
//---------------------
void cscr::close(void)
{
  MouseEraseCursor();
  MouseUnInit();
  
  delete fontlist;
  delete mainrect;

    // back to text mode
  GrSetMode(GR_default_text);
  exit(0);
}

//-----------------------------------------------------
// gets destination rect for a mouse event recursively
//-----------------------------------------------------
crect *getdestrect_r(cscr *s, crect *pr, int x, int y)
{
  clnode *np;
  crect *temp;
  int nx = x - pr->region->x;
  int ny = y - pr->region->y;
  
    // no comments...
  for (np=pr->rlist->start; np; np=np->next)
        {
        temp = (crect *)(np->info);
        if (temp->active)
                if (temp->region->inregion(nx, ny))
                        {
                        return getdestrect_r(s, temp, nx, ny); 
                        }
        }
  return pr;
}

//------------------------------------------
// gets destination rect for the mouseevent
//------------------------------------------
crect *cscr::getdestrect(MouseEvent *event)
{
    // if there is a bully...
  if (bully) return bully;
  
  return getdestrect_r(this, mainrect, event->x, event->y);
}

//------------------------------------------------------
// sets the region (mapped to screen) in wich the mouse
// is active (if NULL then that region is the whole screen)
//------------------------------------------------------
void cscr::setmouseregion(cregion *prg)
{
  if (!prg) 
        MouseSetLimits(0, 0, cx, cy); 
  else 
        MouseSetLimits(prg->x, prg->y, prg->x+prg->cx-1, prg->y+prg->cy-1);
}


//-------------------------------------
// what to do when an exception occurs
//-------------------------------------
void cscr::doexception(void)
{
  switch(this->ex)
        {
        case (EX_WIN_DESTROY):
                
                if (prex)
                        {
                        destroywindow(this, prex);
                        }
                ex = -1;
                break;

        default: break;
        }
}

//======================
// runs the application
//======================
int cscr::run(void)
{
  MouseEvent    event;
  crect         *dest;
  cmousemsg     mousemsg;
  
  int finish = 0;
  while(!finish)
        {

          // any exception?
        if (ex!=-1) doexception();

          // gets the event
        MouseGetEvent(M_EVENT, &event);
        
          // if key pressed 
        if (event.flags & M_KEYPRESS) finish = 1;
        
          // if mouse event
        if (event.flags & M_EVENT)
                {
                  // gets the destination rect
                dest = getdestrect(&event);
                  
                  // creates the mouse message....
                mousemsg.x = event.x;
                mousemsg.y = event.y;
                mousemsg.action = event.flags;

                  // ...and sends it to the dest rect proc
                dest->rectproc((cmsg *)&mousemsg);
                }
        }
}


//--------------
// shows a rect
//--------------
void cscr::showrect(crect *pr, int cl)
{                           
    // sets the active flag
  pr->active = 1;
                
    // if the parent is not active then goout
  if (pr->parent && !pr->parent->active) return;

    // clear the surface?
  if (cl) clear(pr);
  
    // sends a show message to the proc
  cmsg nmsg(MSG_SHOW);
  pr->rectproc(&nmsg);
    
    // sends a paint message to the proc
  cpaintmsg msg;
  rgsize(pr, &(msg.region));
  pr->rectproc(&msg);
}

//--------------
// hides a rect
//--------------
void cscr::hiderect(crect *pr)
{
  clnode *np;
  crect  *child;

  for (np=pr->rlist->start; np; np=np->next) 
        {
        child = (crect *)(np->info);
        hiderect(child);
        }

  pr->active = 0;
}

//---------------------------------
// sends an exception to the kernel
//---------------------------------
void cscr::exception (int ex, crect *prex)
{
  this->ex = ex;
  this->prex = prex;
}

/////////////////////////////
// font managing primitives
/////////////////////////////

// loads a font in the font list
void cscr::loadfont   (char *name, char *desc) 
{
  if (!name) return;

  clnode *np;  
  
    // is the font already loaded?
  for (np=fontlist->start; np; np = np->next)
        {
        if (strcmp(((font *)(np->info))->name, name) != 0) break;
        }   

  if (np) return;

    // creates the new node for storing the font
  font *pfont = new font;
  
    // loads the font
  pfont->f = GrLoadFont(name);

  if (!pfont->f) { delete pfont; return; }

    // fills desc and name
  strcpy(pfont->name, name);
  if (desc) strcpy(pfont->desc, desc);

    // adds the font to the fontlist
  fontlist->push(pfont);             
}

//-----------------------------------
// unloads a font from the font list
//-----------------------------------
void cscr::unloadfont (char *name)
{
  if (!name) return;
  
  clnode *np;

    // is the font loaded?
  for (np=fontlist->start; 
       np && strcmp(((font *)(np->info))->name, name) != 0;
       np = np->next);
                   
  if (!np) return;

  GrUnloadFont(((font *)(np->info))->f);
  
    // deletes the font from the fontlist
  fontlist->del(np);
}

//------------------------------------------------------------------
// returns a font type ptr, that can be used with cbuffer::textxy() 
// name can be the description too
//------------------------------------------------------------------
font *cscr::getfont   (char *name)
{
  clnode *np;

    // looks for the font in the fontlist  (by name)
  for (np=fontlist->start; 
       np && strcmp(((font *)(np->info))->name, name) != 0;
       np = np->next);
    
    // looks for the font in the fontlist  (by description)
  if (!np)
        for (np=fontlist->start; 
                np && strcmp(((font *)(np->info))->desc, name) != 0;
                np = np->next);
  
  if (!np) return NULL;

  return (font *)(np->info);
}
