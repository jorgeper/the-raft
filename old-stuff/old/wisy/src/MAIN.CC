#include <random.h>
#include <stdlib.h>
#include <stdio.h>
#include <dos.h>

#include <wisy.h>
#include <window.h>
#include <button.h>
#include <string.h>
#include <general.h>

#define ID_BOTONCETE 100

typedef struct
{
  int x, y, x2, y2;
}tipolinea;

#define MAX_LINEAS      100

void w1proc(cmsg *msg, void *objdata)
{
  wnddata *data = (wnddata *)objdata;
  cscr *s = data->s;
  crect *r = data->r;

  cregion temp;
  cbuffer *buf;

  static int num_lineas = 0;
  static tipolinea lineas[MAX_LINEAS];
  
  switch(msg->id)
        {
        case (MSG_COMMAND):

                ccmsg *cmsg = (ccmsg *)msg;
                
                if (cmsg->from == ID_BOTONCETE)
                        {
                        rgsize(r, &temp);                         
                                               
                        int max_x = temp.cx;
                        int max_y = temp.cy;
                        
                        if (num_lineas >= MAX_LINEAS) return;
                        lineas[num_lineas].x = rand()%max_x;
                        lineas[num_lineas].y = rand()%max_y;
                        lineas[num_lineas].x2 = rand()%max_x;
                        lineas[num_lineas].y2 = rand()%max_y;

                        s->child_intersection = 1;
                        buf = s->getbuf(r, &temp);                         
                        buf->line(lineas[num_lineas].x, lineas[num_lineas].y, 
                                  lineas[num_lineas].x2, lineas[num_lineas].y2, 0);
                        
                        s->destroybuf(buf);
                        s->child_intersection = 0;
                        
                        num_lineas++;
                        }
                break;
        
        case (MSG_PAINT):
                s->child_intersection = 1;
                buf = s->getbuf(r, &(((cpaintmsg *)msg)->region));                         
                                               
                int max_x = temp.cx;
                int max_y = temp.cy;
                        
                for (int i=0; i<num_lineas; i++)
                        {
                        buf->line(lineas[i].x, lineas[i].y, lineas[i].x2, lineas[i].y2, 0);
                        }
                
                s->destroybuf(buf);
                s->child_intersection = 0;
                break;

        default:
                break;
        }
}

void w2proc(cmsg *msg, void *objdata)
{
}

int main(int argc, char *argv[])
{
  cscr s;
  crect *r[1000];

  if (argc <= 1) return -1;

  int numv = atoi(argv[1]);

  //s.init(1024, 768,256,NULL);
  s.init(800, 600, 256,NULL);
  
  wndprop wp;
  int i;
  int x, y;

  wp.userproc = w2proc;
  wp.parent = NULL;
  for (i=0; i<numv; i++)
        {
        x= rand()%300;
        y = rand()%300;
        wp.props |= (FP_TOFRONT | FP_SIZE | FP_ZOOMBOX | FP_KILL);
        wp.ttlcolor = 4;
        wp.region.resize(x, y, 100+rand()%300, 100+rand()%300);
        r[i]= getwindow(&s, &wp);
        s.showrect(r[i], 0);
        }

  crect *w1;
  wp.userproc = w1proc; 
  wp.parent = NULL;
  wp.props |= (FP_TITLE | FP_SIZE | FP_ZOOMBOX | FP_TOFRONT);
  wp.clprops |= FP_3DBORDER;
  wp.region.resize(10,20,300,200);
  strcpy(wp.title, "Generador de lineas aleatorias 1.0");
  w1 = getwindow(&s, &wp);
  
  crect *w3;
  wp.userproc = w2proc;
  wp.parent = ((wnddata *)(w1->objdata))->client;
  wp.props = (FP_ZOOMBOX | FP_TOFRONT);
  wp.clprops |= FP_3DBORDER;
  wp.region.resize(10,20,300,200);
  w3 = getwindow(&s, &wp);
  s.showrect(w3,0);

  buttprop bp;
  crect *w2;
  bp.id = ID_BOTONCETE;
  bp.parent = ((wnddata *)(w1->objdata))->client;
  bp.props |= FP_CAPTION;
  bp.region.resize(10,10,150,30);
  strcpy(bp.caption, "Nueva linea");
  w2 = getbutton(&s, &bp);
  
  s.showrect(w1,0);
  
  s.run();

  s.close();
}
