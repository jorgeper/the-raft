#ifndef _CMSG_H_
#define _CMSG_H_

#include <mousex.h>


  // mousex add
#define M_MOUSE_EVENT   M_BUTTON_DOWN | M_BUTTON_UP | M_MOTION

#define MSG_CREATE      5
#define MSG_DESTROY     6
#define MSG_PAINT       7
#define MSG_MOUSE       8
#define MSG_RESIZE      4
#define MSG_HIDE        9
#define MSG_COMMAND     10
#define MSG_SHOW        11

class cmsg
{
  public:
  char id;
  int  from;

  cmsg(int id=-1) {this->id = id;}
};

class cpaintmsg:public cmsg
{
  public:
  cregion region;
  cpaintmsg(int id=MSG_PAINT) {this->id = id;}
};


class cmousemsg:public cmsg
{
  public:
  int x, y;
  int action;

  cmousemsg(int id=MSG_MOUSE) {this->id = id;}
};

class ccmsg:public cmsg
{
  public:
  int c;
  ccmsg(int c) {this->id = MSG_COMMAND; this->c = c;}
};

#endif
