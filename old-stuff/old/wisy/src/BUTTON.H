#ifndef _BUTTON_H_
#define _BUTTON_H_

#include <wisy.h>
  
#define MAX_BUTT_CAPTION        50

  // flags for storing temp information
#define FLG_MOVING      1
#define FLG_LEFT_DOWN   2
  
  // flags for the field <props>
#define FP_BORDER     4
#define FP_CAPTION    1

  // default id 
#define IAMNOBODY       1234

  // command messages
#define CB_CLICK        1

typedef struct
{
  int   id;
  cscr  *s;
  crect *r;
  char  flags;
  char  props;
  //void *userdata;
  char  caption[MAX_BUTT_CAPTION];
}buttdata;

class buttprop
{
  public:
    cregion region;  
    void (*userproc)(cmsg msg, void *objdata);
    crect *parent;
    int    props;
    int    id;
    char   caption[MAX_BUTT_CAPTION];

  public:
    buttprop(void)
        {
        region.resize(10,10,100,100);
        userproc = NULL;
        parent = NULL;
        props |= ( 0 | FP_BORDER );
        id = IAMNOBODY;
        }
};

crect  *getbutton     (cscr *s, buttprop *prop);
void    destroybutton (cscr *s, crect *pb);

#endif
