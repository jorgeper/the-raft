#include <button.h>
#include <window.h>
#include <wisy.h>


  // macros for the param <type> in titleevent()
#define IN_TITLE        1
#define IN_BORDER       2

  // ids for the window's buttons
#define ID_BCLOSE       1
#define ID_BSIZE        2

//-------------------------------------
// auxiliary function
// sets the mouse region to this window
//-------------------------------------
void mousetowindow(cscr *s, crect *r)
{
  if (!r->parent) return;

  cregion region = *(r->parent->region);
  rgscrclip(r->parent, rgsize(r->parent, &region));
  s->setmouseregion(&region);
}

//-------------------------------------
// sets the mouse region to the whole screen
//--------------------------------------------
void mousetoscreen(cscr *s)
{
  s->setmouseregion(NULL);
}

//--------------------
//  title mouse event
//--------------------
void titleevent(cmousemsg *msg, wnddata *data)
{                                       
  cscr *s = data->s;            // owner cscr
  crect *r = data->r;           // owner window                    
  cregion temp;
          
       
    // if clicking the title region...
  if (msg->action & M_LEFT_DOWN)
        {
          // takes the control of any event
        s->setbully(r);
        data->flags |= FLG_LEFT_DOWN;
        }
  
    // dropping the window...?
  if (msg->action & M_LEFT_UP) 
        {
          // releases the control
        s->clearbully();

          // yeah
        if (data->flags & FLG_MOVING)
                {
                mousetoscreen(s);
                  
                data->flags &= (!FLG_MOVING);

                  // clears the xorbox
                data->movbuf = s->getbuf(r->parent, rgsize(r->parent, &temp));
                data->movbuf->xorbox(&(data->movrg));
                s->destroybuf(data->movbuf);
               
                  // sends the rectproc a resize msg
                cpaintmsg submsg(MSG_RESIZE);
                submsg.region = data->movrg;
                r->rectproc(&submsg);
                }
        
        data->flags &= (!FLG_LEFT_DOWN);
        }

    // if moving the window...
  if ((msg->action & M_MOTION) && (data->flags & FLG_LEFT_DOWN))
        {

          // clears the last xorbox
        if (data->flags & FLG_MOVING)
                {
                data->movbuf = s->getbuf(r->parent, rgsize(r->parent, &temp));
                data->movbuf->xorbox(&(data->movrg));
                s->destroybuf(data->movbuf);
                }

          // if its the first time...
        if (!(data->flags & FLG_MOVING))
                {
                  // init window data related
                data->movrg = *(r->region);
                data->movx  = msg->x;
                data->movy  = msg->y;
                rgpoint(r, &(data->movx), &(data->movy));
            
                data->flags |= FLG_MOVING;

                  //// selects the action (moving or resizing)
                temp.resize(BORDER_W+1,BORDER_W+1,r->region->cx-(BORDER_W+1)*2, TITLE_H);
                if (temp.inregion(data->movx, data->movy))
                        {
                        data->flags |= FLG_TITLE;
                        }
                 
                  // if tried to resize but not permitted in this window...
                else if (!(data->props & FP_SIZE)) 
                        {
                        data->flags &= (!FLG_MOVING);
                        return;
                        }

                  // left border?
                if (data->movx <= BORDER_W)
                        {
                        data->movx  = msg->x;
                        data->flags |= FLG_LB;
                        }
                  
                  // right border?
                if (data->movx>=r->region->cx-BORDER_W)
                        {
                        data->movx  = msg->x;
                        data->flags |= FLG_RB;
                        }

                  // top border?
                if (data->movy <= BORDER_W)
                        {
                        data->movy  = msg->y;
                        data->flags |= FLG_TB;
                        }
                  
                  // bottom border?
                if (data->movy>=r->region->cy-BORDER_W)
                        {
                        data->movy  = msg->y;
                        data->flags |= FLG_BB;
                        }
                  
                  // mouse only in the parent region
                mousetowindow(s, r);
                }
        
          // maps the point to the parent zone
        int x = msg->x, y=msg->y;
        rgpoint(r->parent, &x, &y);

          // draws the xorbox
        data->movbuf = s->getbuf(r->parent, rgsize(r->parent, &temp));
        
          //// selects the action
          // moving
        if (data->flags & FLG_TITLE)
                {
                data->movrg.x = x-data->movx;
                data->movrg.y = y-data->movy;
                }

          // resizing right border
        if (data->flags & FLG_RB) data->movrg.cx = r->region->cx + msg->x-data->movx;
          
          // resizing bottom border
        if (data->flags & FLG_BB) data->movrg.cy = r->region->cy + msg->y-data->movy;
          
          // resizing left border
        if (data->flags & FLG_LB)
                {
                data->movrg.x = x;
                data->movrg.cx = r->region->cx - msg->x+data->movx-1;
                }
          
          // resizing top border
        if (data->flags & FLG_TB)
                {
                data->movrg.y = y;
                data->movrg.cy = r->region->cy - msg->y+data->movy-1;
                }

          // legal size?    
        if (data->movrg.cx < MIN_WINDOW_W)
                data->movrg.cx = MIN_WINDOW_W;
        
        if (data->movrg.cy < MIN_WINDOW_H)
                data->movrg.cy = MIN_WINDOW_H;
        
        data->movbuf->xorbox(&(data->movrg));
        s->destroybuf(data->movbuf);
        }
}

//--------------------------------
// is (x,y) in the border region?
//--------------------------------
int intitleregion(cregion *prg, int x, int y)
{
  cregion ttlregion(BORDER_W+1,BORDER_W+1,prg->cx-(BORDER_W+1)*2, TITLE_H);

  return (ttlregion.inregion(x,y) ||
          x <= BORDER_W || y <= BORDER_W || 
          x>=prg->cx-BORDER_W || y>=prg->cy-BORDER_W);
}

//-------------
// paint event
//-------------
void paintevent(cpaintmsg *msg, wnddata *data)
{
  cscr *s = data->s;            // owner cscr
  crect *r = data->r;           // owner window                    
  
    // creates a buffer to the paint region
  cbuffer *buf = s->getbuf(r, &(msg->region));
  
    // draws the borders
  buf->filledbox(0, 0, BORDER_W, r->region->cy-1, 7);
  buf->filledbox(0, 0, r->region->cx-1, BORDER_W*2+TITLE_H, 7);
  buf->filledbox(r->region->cx-1-BORDER_W, 0, r->region->cx-1, r->region->cy-1, 7);
  buf->filledbox(0, r->region->cy-1-BORDER_W, r->region->cx-1-BORDER_W, r->region->cy-1, 7);
  
  cregion titlereg;
    
    // draws the title box
  if (data->props & FP_SIZE)
        {
        titlereg.x = BORDER_W*2+TITLE_H-2;
        titlereg.y = BORDER_W;
        titlereg.cx = r->region->cx-BORDER_W*2-TITLE_H*2-4;
        titlereg.cy = TITLE_H;
        }
  else
        {
        titlereg.x = BORDER_W*2+TITLE_H-2;
        titlereg.y = BORDER_W;
        titlereg.cx = r->region->cx-BORDER_W*2-TITLE_H-2;
        titlereg.cy = TITLE_H;
        }
  
  buf->filledbox(&titlereg, data->ttlcolor);
  
  titlereg = titlereg & msg->region;
  if ((data->props & FP_TITLE) && !titlereg.empty())
        {
        cbuffer *buf2 = s->getbuf(r, &titlereg);

        font *pfont = s->getfont("system");
        buf2->textxy(data->title, 
                     BORDER_W+TITLE_H+6, BORDER_W+2, 
                     15, data->ttlcolor, pfont);
        s->destroybuf(buf2);
        }

  struct fx fx;
  fx.c1 = fx.c2 = 15;
  fx.c3 = fx.c4 = 8;
  buf->box3d(0,0,r->region->cx-1, r->region->cy-1,&fx);

  s->destroybuf(buf);
}
    
//===========================
// general window procedure
//===========================
void wndproc(cmsg *msg, void *objdata)
{
  wnddata *data = (wnddata *)objdata;
  cscr *s = data->s;
  crect *r = data->r;
 

  cregion temp;
  cpaintmsg *psubmsg = (cpaintmsg *)msg;
  
  switch(msg->id)
        {
        case (MSG_SHOW):
                  
                  // draw the zoombox?
                if (data->props & FP_ZOOMBOX) 
                {
                  // draws a zoombox
                rgsize(r->parent, &temp);
                cbuffer *buf = s->getbuf(r->parent, &temp);
                                
                cregion r2 = *(r->region);
                r2.x += r->region->cx/2;
                r2.y += r->region->cy/2;
                r2.cx = r2.cy = 1;
                                
                buf->zoombox(&r2, r->region);
                s->destroybuf(buf);
                }  //////endif "data->props & FP_ZOOMBOX"
                
                break;

        case (MSG_MOUSE):
                cmousemsg *msubmsg = (cmousemsg *)msg;
                
                  // if clicking brings it to the front
                if ((msubmsg->action & M_LEFT_DOWN) &&
                    (data->props & FP_TOFRONT)) 
                    s->tofront(r);
                  
                  // if the window was moving...
                if (data->flags & FLG_MOVING) 
                        titleevent(msubmsg, data);

                else 
                        {
                          // maps the point to the window
                        int x = msubmsg->x, y = msubmsg->y;
                        rgpoint(r, &x, &y);
                          
                          // is in the title region?
                        if (intitleregion(r->region, x, y))
                                titleevent(msubmsg, data);
                        }
                  
                break;

        case (MSG_PAINT):
                paintevent(psubmsg, data); 
                  
                break;
        
        case (MSG_RESIZE):

                  // resizes the client rect
                cregion auxrg;
                auxrg.resize(BORDER_W,
                                BORDER_W*2+TITLE_H,
                                psubmsg->region.cx-BORDER_W*2,
                                psubmsg->region.cy-BORDER_W*3-TITLE_H);
                
                s->resize(data->client, &auxrg);
                
                  // resizes the size button
                if (data->props & FP_SIZE)
                        {
                        auxrg.resize(psubmsg->region.cx-TITLE_H-BORDER_W, BORDER_W, TITLE_H, TITLE_H);
                        s->resize(data->bsize, &auxrg);
                        }
                  
                  // if not maximized, then saves sizereg
                if (!(data->flags & FLG_WNDMAX))
                        {
                        data->sizereg = psubmsg->region;
                        }
                           
                break;

        case (MSG_COMMAND):
                ccmsg *cmsg = (ccmsg *)msg;
                
                switch(cmsg->from)
                        {
                        case (ID_BCLOSE):
                          if (cmsg->c == CB_CLICK)
                                {
                                  // sends a MSG_DESTROY
                                cmsg msgaux(MSG_DESTROY);
                                r->rectproc(&msgaux);
                                                                
                                  // draw the zoombox?
                                if (data->props & FP_ZOOMBOX) 
                                {

                                  // draws a zoombox
                                rgsize(r->parent, &temp);
                                cbuffer *buf = s->getbuf(r->parent, &temp);
                                
                                cregion r2 = *(r->region);
                                r2.x += r->region->cx/2;
                                r2.y += r->region->cy/2;
                                r2.cx = r2.cy = 1;
                                
                                buf->zoombox(r->region, &r2);
                                s->destroybuf(buf);
                                }  //////endif "data->props & FP_ZOOMBOX"

                                  // sends a MSG_HIDE
                                msgaux.id = MSG_HIDE;
                                r->rectproc(&msgaux);

                                  // tells the kernel to kill him
                                if (data->props & FP_KILL)
                                        s->exception(EX_WIN_DESTROY, r); 
                                }
                                
                                return;

                        break;
                        
                        case (ID_BSIZE):
                          if (cmsg->c == CB_CLICK)
                                {
                                  // sends a MSG_RESIZE
                                cpaintmsg msgres;
                                msgres.id = MSG_RESIZE;
                                
                                if (data->flags & FLG_WNDMAX)
                                        {
                                        data->flags &= (!FLG_WNDMAX);
                                        msgres.region = data->sizereg;
                                        }
                                else
                                        {
                                        data->flags |= FLG_WNDMAX;
                                        msgres.region = *(r->parent->region);
                                        msgres.region.x = msgres.region.y = 0;
                                        }
                                  
                                  // draw the zoombox?
                                if (data->props & FP_ZOOMBOX) 
                                {

                                  // draws a zoombox
                                rgsize(r->parent, &temp);
                                cbuffer *buf = s->getbuf(r->parent, &temp);
                                
                                buf->zoombox(r->region, &(msgres.region));
                                s->destroybuf(buf);
                                }  //////endif "data->props & FP_ZOOMBOX"
                                  
                                r->rectproc(&msgres);
                                }

                                return;
                        break;
                        }
                break;
        
        default:     
                return;
        }
}

//-------------------
// client rect proc
//-------------------
void clientproc(cmsg *msg, void *objdata)
{
  cldata *data = (cldata *)objdata;
  cscr *s = data->s;
  crect *r = data->r;
 
  switch(msg->id)
        {
          // the paint msg...
        case (MSG_PAINT):

                cpaintmsg *submsg = (cpaintmsg *)msg;
                cbuffer *buf = s->getbuf(r, &(submsg->region));         
                
                  // clear client area?
                if (data->props & FP_CLEAR) 
                        buf->filledbox(&(submsg->region), r->color);
  
                  // draw a 3d border?
                if (data->props & FP_3DBORDER)
                        {
                        struct fx fx;
                        fx.c1 = fx.c2 = 8;
                        fx.c3 = fx.c4 = 15;
                        fx.width = 1;
                        buf->box3d(0,0,r->region->cx-1, r->region->cy-1,&fx);
                        }

                s->destroybuf(buf);
                break;

          // rest of the messages....
        default:  
                  // ...are sent to the parent...
                if (r->parent)
                        {
                        r->parent->rectproc(msg);
                        }

                  // ...and then to the user proc for the child rect
        }
    
    // sends the message to the user procedure for the parent window
  if (r->parent->userproc != NULL) r->parent->userproc(msg, objdata);
}


  // how to draw the X in the close button?
#define PRESSED 1
#define NORMAL  2

//------------------------------------
// paints the 'X' in the close button
//------------------------------------
void paintX(cscr *s, crect *r, int how)
{
  cregion temp;  
  cbuffer *buf = s->getbuf(r, rgsize(r, &temp)); 

  if (how == NORMAL)
        {
        buf->line(5,5,temp.cx-6,temp.cy-6,0);
        buf->line(6,5,temp.cx-5,temp.cy-6,0);
        buf->line(temp.cx-6,5,5,temp.cy-6,0);
        buf->line(temp.cx-5,5,6,temp.cy-6,0);
        }
  else
        {
        buf->line(6,6,temp.cx-5,temp.cy-5,0);
        buf->line(7,6,temp.cx-4,temp.cy-5,0);
        buf->line(temp.cx-5,6,6,temp.cy-5,0);
        buf->line(temp.cx-4,6,7,temp.cy-5,0);
        }
  s->destroybuf(buf);
}

//-------------------------
// close button's user proc
//-------------------------
void bcloseproc(cmsg *msg, void *objdata)
{
  buttdata *data = (buttdata *)objdata;
  cscr *s = data->s;
  crect *r = data->r;

  cregion temp;

  switch(msg->id)
        {
        case (MSG_MOUSE):
          if (data->flags & FLG_LEFT_DOWN) 
                paintX(s,r,PRESSED);
          else 
                paintX(s,r,NORMAL);
          break;

        case (MSG_PAINT):
          paintX(s,r,NORMAL);
          break;

        default:
          break;
        }
}
  
  // how to draw the size button?
#define D_MAX           1
#define D_NORMAL        2

//------------------------
// paints the size button
//------------------------
void paintsize(cscr *s, crect *r, int how, int haw)
{
  cregion temp;  
  int delta = 0;

  cbuffer *buf = s->getbuf(r, rgsize(r, &temp)); 
  if (how == PRESSED) delta = 1;
         
  if (haw == D_MAX)
        buf->box(5+delta, 5,temp.cx-6+delta, temp.cy-6+delta,0);
  else
        buf->box(7+delta, 7,temp.cx-8+delta, temp.cy-8+delta,0);

  s->destroybuf(buf);
}

//-------------------------
// size button's user proc
//-------------------------
void bsizeproc(cmsg *msg, void *objdata)
{
  buttdata *data = (buttdata *)objdata;
  cscr *s = data->s;
  crect *r = data->r;
  wnddata *wdata = (wnddata *)(r->parent->objdata);
  
  int haw;
  if (wdata->flags & FLG_WNDMAX) 
        haw = D_NORMAL;
  else
        haw = D_MAX;

  switch(msg->id)
        {
        case (MSG_MOUSE):
          cmousemsg *mmsg = (cmousemsg *)msg;

          if (mmsg->action & (M_LEFT_DOWN | M_LEFT_UP)) 
                {
                if (mmsg->action & M_LEFT_DOWN) 
                        paintsize(s,r,PRESSED, haw);
                else 
                        paintsize(s,r,NORMAL, haw);
                }
                break;
               
        case (MSG_PAINT):
          paintsize(s,r,NORMAL, haw);
          break;

        default:
          break;
        }
}

//------------------
// creates a window
//------------------
crect *getwindow(cscr *s, wndprop *prop)
{
  crect *pw=NULL;
  
    // allocates memory for the instances data
  wnddata *wdata = (wnddata *)malloc(sizeof(wnddata));
  if (!wdata) return NULL;

    // gets the rect from the cscr object
  if ((pw = s->getrect(&(prop->region), prop->parent)) == NULL)
        {
        free (wdata);
        return NULL;
        }

    // init data
  wdata->s = s;
  wdata->r = pw;
  wdata->flags = 0;
  wdata->props = prop->props;
  wdata->id = prop->id;
  wdata->ttlcolor = prop->ttlcolor;
  wdata->sizereg = prop->region;
  if (prop->props & FP_TITLE) strcpy(wdata->title, prop->title);
    
    // init some window fields
  pw->userproc = prop->userproc;  
  pw->objproc  = wndproc;
  pw->objdata  = wdata;
  
  cregion clientrg;
  clientrg.resize(BORDER_W,BORDER_W*2+TITLE_H,
                  prop->region.cx-BORDER_W*2,prop->region.cy-BORDER_W*3-TITLE_H);

    // gets the client rect from the cscr object
  if ((wdata->client = s->getrect(&clientrg, pw)) == NULL)
        {
        s->destroyrect(pw);
        free (wdata);
        return NULL;
        }
    
    //// init client rect's data
  cldata *cdata = (cldata *)malloc(sizeof(cldata));
  if (!cdata)
        {
        s->destroyrect(pw);
        s->destroyrect(wdata->client);
        free(wdata);
        return NULL;
        }
  cdata->s = s;
  cdata->r = wdata->client;
  cdata->id = prop->id;
  cdata->props = prop->clprops;

    // init client rect
  wdata->client->userproc = NULL;  
  wdata->client->objproc  = clientproc;
  wdata->client->objdata  = cdata;
  wdata->client->color = prop->clcolor;
  wdata->client->active=1;    
  

    // close button
  buttprop bp;
  bp.region.resize(BORDER_W, BORDER_W, TITLE_H, TITLE_H);
  bp.userproc = bcloseproc;
  bp.parent = pw;
  bp.id = ID_BCLOSE;
  bp.props = 0;
  wdata->bclose = getbutton(s, &bp);  
    
    // size button
  if (prop->props & FP_SIZE)
        {
        bp.region.resize(prop->region.cx-TITLE_H-BORDER_W, BORDER_W, TITLE_H, TITLE_H);
        bp.userproc = bsizeproc;
        bp.parent = pw;
        bp.id = ID_BSIZE;
        bp.props = 0;
        wdata->bsize = getbutton(s, &bp);  
        }

  return pw;
}

//-------------------------------------------
// destroys the window created with getwindow
//-------------------------------------------
void destroywindow(cscr *s, crect *pw)
{
  wnddata *wdata = (wnddata *)pw->objdata;

  free (wdata->client->objdata);
  s->destroyrect(wdata->client);

  destroybutton(s, wdata->bclose);
  if (wdata->props & FP_SIZE)
        {
        destroybutton(s, wdata->bsize);
        }
  
  free (pw->objdata);
  
  s->destroyrect(pw);
}
