#ifndef _FONT_H_
#define _FONT_H_

#define MAX_FONTDESC            40
#define MAX_FONTNAME            20
  
  // struct for the system loaded fonts
typedef struct
{
  char desc[MAX_FONTDESC];      // description
  char name[MAX_FONTNAME];      // font name 
  GrFont *f;                 
}font;

#endif
