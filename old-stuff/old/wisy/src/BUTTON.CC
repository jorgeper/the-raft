#include <button.h>
#include <wisy.h>
#include <string.h>

void paintbutt (crect *butt, cregion *prg, buttdata *data, int how);

#define PAINT_NORMAL    1
#define PAINT_PRESSED   2

void mouseevent(cmousemsg *msg, buttdata *data)
{                                       
  cscr *s = data->s;            // owner cscr
  crect *r = data->r;           // owner window                    
  cregion temp;

  rgsize(r, &temp);
    
    // if clicked the button...
  if (msg->action & M_LEFT_DOWN)
        {
        s->setbully(r);
        data->flags |= FLG_LEFT_DOWN;
        paintbutt(r, &temp, data, PAINT_PRESSED); 
        
        if (r->userproc != NULL) r->userproc(msg, data);
        }
  
  if (msg->action & M_LEFT_UP) 
        {
        s->clearbully();
        data->flags &= (!FLG_LEFT_DOWN);
        paintbutt(r, &temp, data, PAINT_NORMAL); 
        
          // sends the user the msg
        if (r->userproc != NULL) r->userproc(msg, data);
        
          // sends the parent a MSG_COMMAND
        ccmsg cmsg(CB_CLICK);
        cmsg.from = data->id;
        r->parent->rectproc(&cmsg);
        }                
}

void paintbutt (crect *butt, cregion *prg, buttdata *data, int how)
{
  cscr *s = data->s;            // owner cscr
  crect *r = data->r;           // owner window                    
    
    // creates a buffer to the paint region
  cbuffer *buf = s->getbuf(r, prg);
  
  
  struct fx fx;
  fx.width = 2;
  
  int delta;

  switch(how)
        {
        case (PAINT_NORMAL):
                fx.c1 = fx.c2 = 15;
                fx.c3 = fx.c4 = 8;
                delta = 0;
                break;
        
        case (PAINT_PRESSED):
                fx.c1 = fx.c2 = 8;
                fx.c3 = fx.c4 = 7;
                fx.width = 1;
                delta = 1;
                break;
        
        default: break;
        }
  
    // draws the button's surface
  buf->filledbox(0, 0, r->region->cx-1, r->region->cy-1, 7);
  
    // draws the button caption
  if (data->props & FP_CAPTION)
         {
         font *pfont = s->getfont("system");
         int xcap = (r->region->cx - (strlen(data->caption)*SF_W));
           // ????????? 
         if (xcap < 0) {xcap=-xcap; xcap>>=1; xcap=-xcap;}
         else {xcap>>=1;}
        
         int ycap = (r->region->cy-SF_H);
         if (ycap < 0) {ycap=-ycap; ycap>>=1; ycap=-ycap;}
         else {ycap>>=1;}

         if (data->caption) buf->textxy(data->caption, xcap+delta, ycap+delta, 0, 7, pfont);
         }
  
    // draws the border
  if (data->props & FP_BORDER)
        buf->box(0,0,r->region->cx-1, r->region->cy-1,0);
  
  if (data->props & FP_BORDER)
        buf->box3d(1,1,r->region->cx-2, r->region->cy-2,&fx);
  else 
        buf->box3d(0,0,r->region->cx-1, r->region->cy-1,&fx);
  
  s->destroybuf(buf);
}

//===========================
// general button procedure
//===========================
void buttproc(cmsg *msg, void *objdata)
{
  buttdata *data = (buttdata *)objdata;
  cscr *s = data->s;
  crect *r = data->r;
 
  cregion temp;
          
  switch(msg->id)
        {
        case (MSG_MOUSE):
                cmousemsg *msubmsg = (cmousemsg *)msg;
                
                  // maps the point to the window
                int x = msubmsg->x, y = msubmsg->y;
                rgpoint(r, &x, &y);
                         
                  // going to the mouse event procedure...
                mouseevent(msubmsg, data);
                break;

        case (MSG_PAINT):
                cpaintmsg *psubmsg = (cpaintmsg *)msg;
                paintbutt(r, &(psubmsg->region), data, PAINT_NORMAL); 
                if (r->userproc != NULL) r->userproc(msg, objdata);
                break;
        
        default:     
                if (r->userproc != NULL) r->userproc(msg, objdata);
                return;
        }

}

//------------------
// creates a button
//------------------
crect *getbutton(cscr *s, buttprop *prop)
{
  crect *pb=NULL;
  
    // allocates memory for the instances data
  buttdata *bdata = (buttdata *)malloc(sizeof(buttdata));
  if (!bdata) return NULL;

    // gets the rect from the cscr object
  if ((pb = s->getrect(&(prop->region), prop->parent)) == NULL)
        {
        free (bdata);
        return NULL;
        }
  
    // init data
  bdata->s = s;
  bdata->r = pb;
  bdata->flags = 0;
  bdata->id = prop->id;
  bdata->props = prop->props;
  if (prop->props & FP_CAPTION) strcpy(bdata->caption, prop->caption);

    // init some button fields
  pb->userproc = prop->userproc;  
  pb->objproc  = buttproc;
  pb->objdata  = bdata;
  
  pb->active = 1;

  return pb;
}

//-------------------------------------------
// destroys the button created with getbutton
//-------------------------------------------
void destroybutton(cscr *s, crect *pb)
{
  if (pb->objdata) free (pb->objdata);
  s->destroyrect(pb);
}
