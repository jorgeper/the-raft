/****************************************************************************

   TVIEWS.H, 23-Agosto-1995. Jorge Pereira                                   
				                                                                                                                                                                                                                                                                   
   Archivo header de funciones para manejo de textos en la pantalla          
   mediante ventanas de texto                                                                                                      
				                                                                                                                                                                                                                                                                   
****************************************************************************/


	/* archivos include */

#include <stdio.h>
#include <stdlib.h>
#include <conio.h>
#include <io.h>
#include <mem.h>
#include <dos.h>
#include <alloc.h>


	/* algunos defines comunes */

#define MALROLLO        -1
#define NOPROBLEMO      0
#define status          int
#define byte            unsigned char
#define u_int           unsigned int

#define DEFAULT         0
#define SCREEN          NULL


 /* valores por defecto para las ventanas de texto */

#define TVIEW_DEF_XSCR          0u
#define TVIEW_DEF_YSCR          0u
#define TVIEW_DEF_HEIGTH        10u
#define TVIEW_DEF_WIDTH         20u

#define TWIN_DEF_HEIGTH         25u
#define TWIN_DEF_WIDTH          80u
#define TWIN_DEF_BCOLOR         BLACK
#define TWIN_DEF_FCOLOR         LIGHTGRAY
#define TWIN_DEF_XCUR           0u
#define TWIN_DEF_YCUR           0u

	/* valores del modo de texto */

#define VIDEO_WIDTH                     80
#define VIDEO_HEIGTH                    25

	/* valores maximos */

#define TWIN_MAX_SIZE                   80*25*2*16u     /* max. tama¤o del buffer del twin */



/*******************************************
																				  
   ESTRUCTURAS PARA LAS VENTANAS DE TEXTO   
																				  
********************************************/


	/* estructura para los visores (tview - Text VIEWer) */

typedef struct{

	u_int xbuf, ybuf;                       /* coordenadas en el buffer */
	u_int xscr, yscr;                       /* coordenadas en la pantalla */
	u_int heigth, width;                    /* alto y ancho de la ventana */

}tview;


	/* estructura para las ventanas de texto (twin - Text WINdow) */

typedef struct{

	byte *buffer;                           /* buffer con el texto */
	u_int heigth, width;                    /* ancho y alto del buffer */

	tview viewer;                           /* visor en la pantalla */

	u_int xcur, ycur;                       /* posicion del cursor */
	byte fcolor, bcolor;                    /* color actual */

}twin;



/*************************************************
**                                                                                                                                                                                      **
** FUNCIONES DE MANEJO DE LAS VENTANAS DE TEXTO **
**                                                                                                                                                                                      **
*************************************************/

	/* declaracion de los prototipos de las funciones */

status twInit(twin **twpp, u_int heigth, u_int width, u_int vHeigth, u_int vWidth);

status twDestroy(twin **twpp);

status twPrint(twin *twp, char *text);

status twGoto(twin *twp, u_int x, u_int y);

status twColor(twin *twp, byte fcolor, byte bcolor);

status twClear(twin *twp);

status tvSize(twin *twp, u_int heigth, u_int width);

status tvPos(twin *twp, u_int x, u_int y);

status tvBufPos(twin *twp, u_int x, u_int y);

status twDump(twin *source, twin *dest);

void initScreen(void);

char *strrep(char *buffer, u_int rep, char mod);

status twPrintf(twin *twp, char *string, ...);

u_int twWherey(twin *twp);

u_int twWherex(twin *twp);

status twChangeColor(twin *twp, u_int x, u_int y, u_int heigth, u_int width, int fcolor, int bcolor);

status twCopyBox(twin *source, twin *dest, u_int x, u_int y);


