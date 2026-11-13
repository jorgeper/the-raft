#include <dos.h>
#include <stdio.h>
#include <stdlib.h>
#include <conio.h>
#include <io.h>
#include <alloc.h>
#include <string.h>


#define MOUSE_EVENT 	1	/* evento de raton */
#define KEY_EVENT 	2 	/* evento de teclado */

#define NO_CHANGE	-1
#define INC		-2
#define DEC		-3

#define IN_DESKTOP	-1
#define TO_BACKGROUND	1
#define TO_DESKTOP	2
#define TO_SCREEN	3


#define LIST_START 	0
#define LIST_END	-1

#define NOTITLE		NULL
#define DEFAULT_PROPS 	NULL

#define DT_DEF_X        1
#define DT_DEF_Y	1
#define DT_DEF_HEIGTH   VIDEO_HEIGTH-2
#define DT_DEF_WIDTH	VIDEO_WIDTH-2
#define DT_DEF_NODE     '°'
#define DT_DEF_NFCOLOR	BLUE
#define DT_DEF_NBCOLOR 	LIGHTGRAY
#define DT_DEF_WAUXFCOLOR	LIGHTGREEN

#define WN_DEF_X	10
#define WN_DEF_Y	3
#define WN_DEF_RHEIGTH	11
#define WN_DEF_RWIDTH	35
#define WN_DEF_VHEIGTH	8
#define WN_DEF_VWIDTH	30
#define WN_DEF_TFCOLOR	WHITE
#define WN_DEF_BFCOLOR	WHITE
#define WN_DEF_BCOLOR	BLUE
#define WN_DEF_TITLE    NOTITLE
#define WN_DEF_CHSIZE	TRUE
#define WN_DEF_CHFRONT	FALSE

#define WN_MIN_VHEIGTH	1
#define WN_MIN_VWIDTH	20
#define WN_MAX_VHEIGTH	VIDEO_HEIGTH-2
#define WN_MAX_VWIDTH	VIDEO_WIDTH-2

#define WN_MIN_RHEIGTH	1
#define WN_MIN_RWIDTH	20
#define WN_MAX_RHEIGTH	VIDEO_HEIGTH-2
#define WN_MAX_RWIDTH	VIDEO_WIDTH-2


#include "common.h"
#include "tviews.h"


	/****** ESTRUCTURAS DE DATOS PARA LOS EVENTOS ******/


	/* tipo de evento de teclado */

typedef struct{

	int key;

} keyEvent;


	/* tipo de evento de raton */

typedef struct{

	int x, y;	   		/* posicion x, y */
	boolean left, right, both;	/* botones pulsados TRUE o FALSE */
	boolean move;
	boolean butchange;

} mouseEvent;


	/* datos de los eventos primarios */

typedef struct {

	mouseEvent mouse;		/* para los eventos de raton */
	keyEvent key; 			/* para los eventos de teclado */

} stData;


	/* EVENTO PRIMARIO */

typedef struct {

	int type;			/* tipo de evento (mouse, raton) */
	stData data;			/* datos del evento */

} stEvent;

	/* region activa */

typedef struct{

	int number;			/* numero de region activa */
	mouseEvent mouse;		/* evento del mouse referido a esa region */
	mouseEvent mouse_;		/* evento del mouse referido a la aplicacion */

} arEvent;




	/****** ESTRUCTURAS DE DATOS PARA LAS VENTANAS ******/


typedef struct{

	char *title;			/* titulo de la ventana */

	boolean chsize;            	/* se puede cambiar el tama¤o ? */
	boolean chfront;	      	/* debe estar siempre en primer plano ) */

	int x, y;		       	/* posicion de la ventana en el escritorio */
	int rheigth, rwidth;		/* tama¤o real de la ventana */
	int vheigth, vwidth;		/* tama¤o de la ventana en el escritorio */

	int tfcolor;			/* title fore color */
	int bcolor, bfcolor;		/* background color, border fore color */

} wnprops;


typedef struct{

	int id;				/* identificador de la ventana */

	boolean active;			/* esta activa la ventana ? */
        boolean ismaxim;		/* esta maximiazada ? */		    
	int rvheigth, rvwidth;		/* tama¤o de la ventana antes de la ultima
					vez que se maximizo */
	int rx, ry;			/* posicion de la ventana antes de la
					ultima vez que se maximizo */

	twin *wind;			/* twindow de la ventana */

	wnprops props;			/* propiedades de la ventana */

	boolean initOk;			/* se inicializo correctamente ? */

} win;

struct winnode{

	struct winnode *next;		/* puntero al siguiente nodo */
	struct winnode *prev;		/* puntero al anterior nodo */
	win *winp;			/* puntero a la ventana */

};

typedef struct winnode winnode;

typedef struct{

	winnode *lstart;		/* puntero al primer nodo */
	winnode *lend;			/* puntero al ultimo nodo */

}winlist;


typedef struct{

	int x, y;   			/* posicion del escritorio en la pantalla */
	int heigth, width;		/* alto y ancho */

	char node;			/* caracter de relleno del fondo */
	int nfcolor, nbcolor;		/* node fore color, node back color */

	int wauxfcolor;			/* color auxiliar para las ventanas */

} dtprops;


typedef struct{

	twin *back;			/* fondo del escritorio */
	twin *desk;			/* escritorio entero */

	winlist wl;		      	/* lista de ventanas activas */

	dtprops props;			/* propiedades del escritorio */

	boolean initOk;			/* se inicializo correctamente ? */

} desktop;



status dtDump(desktop *dtp);

status dtRefresh(desktop *dtp);

void dtRestoreBack(desktop *dtp);

status mouseInit();
void mouseHide();
void mouseShow();
boolean mouseGetEvent(mouseEvent *);
boolean getEvent();




desktop AppDesktop;


/*******************************************

	FUNCIONES PARA LAS VENTANAS

*******************************************/




/********** FUNCIONES PARA LA LISTA DE VENTANAS **********/



void wlInit(winlist *wlp)

	/* inicializa la lista de ventanas activas */

{

	wlp->lstart = NULL;
	wlp->lend = NULL;

}


int wlSize(winlist *wlp)

	/* devuelve el tama¤o de la lista de ventanas activas */

{

	winnode **npp;
	int i;

		/* recorre la lista contando los nodos */

	for(npp = &(wlp->lstart), i = 0; *npp != NULL; npp = &((*npp)->next), i++)

		;

	return i;

}


boolean wlIsEmpty(winlist *wlp)

	/* esta vacia la lista de ventanas ? */

{

	return (wlp->lstart == NULL);

}


void wlPrintNode(winnode *np)

	/* imprime datos de un nodo */

{

	printf("\n%i", np->winp->id);

}


status wlProc(winlist *wlp, void (*proc)(winnode *))

	/* recorre la lista efectuando la funcion proc sobre los nodos */

{
	winnode *np;

	if(wlIsEmpty(wlp)) return MALROLLO;

	for(np=wlp->lstart; ; np=np->next){

		(*proc)(np);
		if(np->next==NULL) break;

	}

	return NOPROBLEMO;

}

status wlGetNode(winnode **npp)

	/* reserva memoria para un nuevo nodo */

{
		/* reserva memoria para el nodo */

	if((*npp = (winnode *) malloc(sizeof(winnode))) == NULL) return MALROLLO;

	return NOPROBLEMO;

}


void wlFreeNode(winnode **npp)

	/* libera la memoria que ocupa un nodo */

{

	free(*npp);

}


status wlAddItem(winlist *wlp, win *wnp, int position)

	/* a¤ade una ventana a la lista de ventanas activas */

{

	int i;
	int listsize;
	winnode *nextnode, *np;


		/* si la posicion es mayor que el tama¤o de la lista devuelve
		error */

	if(position > (listsize = wlSize(wlp))) return MALROLLO;

	if(position == LIST_END) position = listsize;

		/* si se quiere insertar al principio ... */

	if(position == LIST_START){

			/* guarda la direccion del siguiente nodo */

		nextnode = wlp->lstart;

		wlGetNode(&(wlp->lstart));

			/* guarda el dato */

		wlp->lstart->winp = wnp;

			/* ajusta los punteros next y prev del nodo creado */

		wlp->lstart->prev = NULL;
		wlp->lstart->next = nextnode;

			/* si se inserto al final, tambien hay que actualizar lend */

		if(position == listsize) wlp->lend = wlp->lstart;

		else nextnode->prev = wlp->lstart;

	}
		/* ... y si se quiere insertar en cualquier otra posicion ... */

	else{

			/* busca el nodo que esta en la posicion position */

		for(i = 0, np = wlp->lstart; i < position - 1; i++, np = np->next)

			;


			/* guarda la direccion del siguiente nodo */

		nextnode = np->next;

			/* reserva memoria para el nuevo nodo */

		wlGetNode(&(np->next));

			/* guarda el dato */

		np->next->winp = wnp;

			/* ajusta los punteros next y prev */

		np->next->next = nextnode;
		np->next->prev = np;

			/* si se inserto al final, tambien hay que actualizar lend */

		if(position == listsize) wlp->lend = np->next;

		else nextnode->prev = np->next;

	}

	return NOPROBLEMO;

}



status wlDelItem(winlist *wlp, win **wnp, int position)

	/* borra un nodo de la lista de ventanas */

{

	int i;
	int listsize;
	winnode *nextnode, *np;


		/* si la lista esta vacia devuelve error */

	if(wlIsEmpty(wlp)) return MALROLLO;

		/* si la posicion es mayor que el tama¤o de la lista devuelve
		error */

	if(position > (listsize = wlSize(wlp))) return MALROLLO;

	if(position == LIST_END) position = listsize - 1;


		/* si se quiere borrar el nodo del comienzo de la lista ... */

	if(position == LIST_START){

			/* guarda la direccion del siguiente nodo */

		nextnode = wlp->lstart->next;

			/* guarda el dato */

		*wnp = wlp->lstart->winp;

		wlFreeNode(&(wlp->lstart));

			/* ajusta los punteros next y prev */

		wlp->lstart = nextnode;

			/* si se elimino al final, tambien hay que actualizar lend */

		if(position == listsize - 1) wlp->lend = wlp->lstart;

		else nextnode->prev = NULL;

	}

		/* ... o si se quiere borrar en cualquier otra posicion ... */

	else{
			/* busca el nodo que esta en la posicion position */

		for(i = 0, np = wlp->lstart; i < position - 1; i++, np = np->next)

			;

		nextnode = np->next->next;

		*wnp = np->next->winp;

		wlFreeNode(&(np->next));

		np->next = nextnode;

		if(position == listsize -1) wlp->lend = np;

		else nextnode->prev = np;

	}

	return NOPROBLEMO;
}


status wlChangeNodes(winlist *wlp, int pos1, int pos2)

	/* intercambia dos nodos de posicion en la lista */

{

	win *aux;
	int listsize, i;
	winnode **npp, *np1, *np2;


		/* chequea posibles errores */

	listsize = wlSize(wlp);

		/* si la lista esta vacia devuelve error */

	if(wlIsEmpty(wlp)) return MALROLLO;

		/* si las posiciones se salen de la lista devuelve error */

	if((pos1 >= listsize) || (pos2 >= listsize)) return MALROLLO;

	if(pos1 == LIST_END) pos1 = listsize - 1;
	if(pos2 == LIST_END) pos2 = listsize - 1;

		/* recorre la lista buscando ambos nodos */

	for(npp = &(wlp->lstart), i = 0; i < max(pos1, pos2); i++){

		if(i == min(pos1, pos2)) np1 = *npp;

		npp = &((*npp)->next);

	}

	np2 = *npp;

		/* ahora, intercambia sus contenidos */

	aux = np1->winp;

	np1->winp = np2->winp;

	np2->winp = aux;



	return NOPROBLEMO;

}


status wlChangePos(winlist *wlp, int pos1, int pos2)

	/* mueve el nodo de la posicion 1 a la posicion 2 */

{
	win *winp;

		/* borra el nodo de pos1 ... */

	if(wlDelItem(wlp, &winp, pos1) == MALROLLO) return MALROLLO;

		/* ... y lo a¤ade en pos2 */

	if(wlAddItem(wlp, winp, pos2) == MALROLLO) return MALROLLO;

	return NOPROBLEMO;

}


void wlFree(winlist *wlp)

	/* libera la memoria que ocupa la lista de ventanas */

{

	win *wnp;

	while(!wlIsEmpty(wlp)) wlDelItem(wlp, &wnp, LIST_START);

}


winnode *wlFindItem(winlist *wlp, int position)

	/* devuelve el puntero al nodo de la posicion position */

{

	int i, listsize;
	winnode *np;

		/* si la lista esta vacia devuelve error */

	if(wlIsEmpty(wlp)) return NULL;

		/* si la posicion es mayor que el tama¤o de la lista devuelve
		error */

	if(position > (listsize = wlSize(wlp))) return NULL;

	if(position == LIST_END) position = listsize - 1;

	for(i = 0, np = wlp->lstart; i < position - 1; i++, np = np->next)

        	;

	return np;

}


/********** FUNCIONES PARA LAS VENTANAS **********/


boolean wnIsMaxim(win *wnp)

	/* devuelve si la ventana esta maximizada o no */

{


	return ((wnp->props.rheigth == wnp->props.vheigth)

	&& (wnp->props.vwidth == wnp->props.rwidth));

}


status wnChangeProps(desktop *dtp, win *wnp, wnprops *pp)

	/* cambia las propiedades de una ventana */

{


	wnprops auxprops;


		/* si se quiere inicializar con las propiedades por defecto ... */

	if(pp == DEFAULT_PROPS){

		auxprops.x = WN_DEF_X;
		auxprops.y = WN_DEF_Y;

		auxprops.rheigth = WN_DEF_RHEIGTH;
		auxprops.rwidth = WN_DEF_RWIDTH;

		auxprops.vheigth = WN_DEF_VHEIGTH;
		auxprops.vwidth = WN_DEF_VWIDTH;

		auxprops.tfcolor = WN_DEF_TFCOLOR;

		auxprops.bcolor = WN_DEF_BCOLOR;
		auxprops.bfcolor = WN_DEF_BFCOLOR;
		auxprops.title = WN_DEF_TITLE;

		auxprops.chsize = WN_DEF_CHSIZE;

	}

		/* ... si no ... */

	else{

		auxprops = *pp;

	}



		/* verifica los posibles errores */

		/* la ventana no se puede salir del escritorio */

	if(auxprops.x > dtp->props.x + dtp->props.width) return MALROLLO;

	if(auxprops.y > dtp->props.y + dtp->props.heigth) return MALROLLO;

		/* el tama¤o visual no puede ser mayor que el tama¤o real */

	if((auxprops.vheigth > auxprops.rheigth) || (auxprops.vwidth > auxprops.rwidth)) return MALROLLO;


		/* no puede tener un tama¤o mayor que el del escritorio */

	if((auxprops.rheigth > dtp->props.heigth) || (auxprops.rwidth > dtp->props.width)) return MALROLLO;

		/* no puede tener un tama¤o mayor que el maximo ni menor que el
		minimo, en cualquier caso */

	if((auxprops.rheigth > WN_MAX_RHEIGTH) || (auxprops.rwidth > WN_MAX_RWIDTH)
		|| (auxprops.rheigth < WN_MIN_RHEIGTH) || (auxprops.rwidth < WN_MIN_RWIDTH))

		return MALROLLO;

	if((auxprops.vheigth > WN_MAX_VHEIGTH) || (auxprops.vwidth > WN_MAX_VWIDTH)
		|| (auxprops.vheigth < WN_MIN_VHEIGTH) || (auxprops.vwidth < WN_MIN_VWIDTH))

		return MALROLLO;



		/* asigna el nuevo valor para las propiedades */

	wnp->props = auxprops;

		/* segun las propiedades, ajusta el valor de ismaxim */

	wnp->ismaxim = wnIsMaxim(wnp);

	return NOPROBLEMO;

}


void wnGetProps(win *wnp, wnprops *pp)

	/* devuelve las propiedades de una ventana */

{

	*pp = wnp->props;


}

status wnInit(desktop *dtp, win *wnp, wnprops *pp, int id)

	/* inicializa una ventana */

{


		/* de momento, initOk es false */

	wnp->initOk = FALSE;


        	/* cambia las propiedades de la ventana */

	if(wnChangeProps(dtp, wnp, pp) == MALROLLO) return MALROLLO;

		/* la ventana de momento no esta activa */

	wnp->active = FALSE;

		/* pone el identificador de la ventana */

	wnp->id = id;

	wnp->initOk = TRUE;

	return NOPROBLEMO;

}


void wnFree(win *wnp)

	/* libera la memoria que ocupa una ventana */

{

                /********************************/
		/********* FALTA CODIGO *********/
		/********************************/


}


boolean wnIsActive(win *wnp)

	/* esta activa la ventana ? */

{

	return wnp->active;

}


void wnPrintHBar(desktop *dtp, win *wnp, twin *tempwin)

	/* imprime la barra horizontal de una ventana */

{

	char lin[VIDEO_WIDTH];
	int barwidth, poswidth;
	int posx;

	barwidth = wnp->props.vwidth-4;


		/* imprime la barra vacia */

	twGoto(tempwin, 2, wnp->props.vheigth+1);

	twColor(tempwin, wnp->props.bfcolor, wnp->props.bcolor);
	twPrintf(tempwin, "%c", 17);

	twColor(tempwin, wnp->props.bfcolor, wnp->props.bcolor);
	strrep(lin, barwidth, '°');

	twPrintf(tempwin, "%s", lin);

	twColor(tempwin, wnp->props.bfcolor, wnp->props.bcolor);
	twPrintf(tempwin, "%c", 16);

		/* imprime la posicion */

	poswidth = (barwidth * wnp->props.vwidth) / (wnp->props.rwidth);

		/* ajuste ... */

	if(poswidth == 0) poswidth = 1;

	posx = (barwidth * wnp->wind->viewer.xbuf) / wnp->props.rwidth;

		/* ajuste ... */

	if(wnp->wind->viewer.xbuf == wnp->props.rwidth - wnp->props.vwidth)

		posx = barwidth - poswidth;


	twGoto(tempwin, 3+posx, wnp->props.vheigth+1);

	twPrint(tempwin, strrep(lin, poswidth, '±'));


}


void wnPrintVBar(desktop *dtp, win *wnp, twin *tempwin)

	/* imprime la barra vertical de una ventana */

{
	boolean min = FALSE; 	/* se tubo que ajustar la barra de posicion ? */
	int i;
	int barheigth, posheigth;
	int posy;

	barheigth = wnp->props.vheigth-2;

		/* imprime la barra vacia */

	twGoto(tempwin, wnp->props.vwidth+1, 1);

	twColor(tempwin, wnp->props.bfcolor, wnp->props.bcolor);
	twPrintf(tempwin, "%c", 30);

	twColor(tempwin, wnp->props.bfcolor, wnp->props.bcolor);

	for(i=0; i< barheigth; i++){

		twGoto(tempwin, wnp->props.vwidth+1, 2+i);
		twPrint(tempwin, "°");

	}

	twGoto(tempwin, wnp->props.vwidth+1, wnp->props.vheigth);
	twColor(tempwin, wnp->props.bfcolor, wnp->props.bcolor);
	twPrintf(tempwin, "%c", 31);

		/* imprime la posicion */

	posheigth = (barheigth * wnp->props.vheigth) / (wnp->props.rheigth);

		/* ajuste ... */

	if(posheigth == 0){

		min = TRUE;
		posheigth = 1;

	}

	posy = (barheigth * wnp->wind->viewer.ybuf) / wnp->props.rheigth;

		/* ajuste ... */

	if(wnp->wind->viewer.ybuf == wnp->props.rheigth - wnp->props.vheigth){

		posy = barheigth - posheigth;

		if(min) posy = barheigth;

	}

	for(i=0; i< posheigth; i++){

		twGoto(tempwin, wnp->props.vwidth+1, posy+2+i);
		twPrint(tempwin, "±");

	}

}


status wnDump(desktop *dtp, win *wnp, int where)

	/* vuelca una ventana al escritorio o al fondo */

{

	boolean isFront;
	char fchar;
	int res;
	boolean cut = FALSE;
	int i, titlex;
	char lin[VIDEO_WIDTH];
	twin **twpp;
	twin *tempwin;

	isFront = (wnp == dtp->wl.lstart->winp);


		/* si no esta correctamente inicializada, devuelve error */

	if(!wnp->initOk) return MALROLLO;

		/* primero elige el destino */

	if(where == TO_BACKGROUND) twpp = &(dtp->back);

	else if(where == TO_DESKTOP) twpp = &(dtp->desk);

	else return MALROLLO;


		/* crea el twindow auxiliar */

	if(twInit(&tempwin, wnp->props.vheigth +2, wnp->props.vwidth+2, wnp->props.vheigth+2, wnp->props.vwidth+2)

		== MALROLLO) return MALROLLO;

	twColor(tempwin, 0, wnp->props.bcolor); twClear(tempwin);


		/* imprime el borde de la ventana en el twindow auxiliar */

	if(isFront) strrep(lin, wnp->props.vwidth, 'Í');

	else strrep(lin, wnp->props.vwidth, 'Ä');

	twColor(tempwin, wnp->props.bfcolor, wnp->props.bcolor);

		/* linea superior */

	if(isFront) twPrintf(tempwin, "%c%s%c", 'É', lin, '»');

	else twPrintf(tempwin, "%c%s%c", 'Ú', lin, '¿');

		/* linea inferior */

	twGoto(tempwin, 0, wnp->props.vheigth+1);

	if(isFront) twPrintf(tempwin, "%c%s%c", 'È', lin, '¼');

	else twPrintf(tempwin, "%c%s%c", 'À', lin, 'Ù');

		/* lineas laterales */

	for(i=0; i < wnp->props.vheigth ; i++){

		twGoto(tempwin, 0, i+1);

		if(isFront) twPrint(tempwin, "º");

		else twPrint(tempwin, "³");

		twGoto(tempwin, wnp->props.vwidth+1, i+1);

		if(isFront) twPrint(tempwin, "º");

		else twPrint(tempwin, "³");
	}

		/* imprime el titulo */

	if(wnp->props.title != NOTITLE){


		if(strlen(wnp->props.title) < wnp->props.vwidth)

			titlex = (wnp->props.vwidth - strlen(wnp->props.title)) / 2;

		else

			titlex = 5;

			/* si no cabe el titulo ... */

		res = 8;
		if(wnp->props.chsize) res +=4;

		if(titlex < 6) {

			titlex = 6;

				/* recorta el titulo a imprimir */

			fchar = wnp->props.title[wnp->props.vwidth-res];
			wnp->props.title[wnp->props.vwidth-res] = '\0';

			cut = TRUE;

		}

		twGoto(tempwin, titlex, 0);
		twPrintf(tempwin, " %s ", wnp->props.title);

		if(cut) wnp->props.title[wnp->props.vwidth-res] = fchar;

	}

		/* imprime los diferentes botones */

	twGoto(tempwin, 2, 0);
	twPrint(tempwin, "[ ]");

	twColor(tempwin, dtp->props.wauxfcolor, wnp->props.bcolor);
	twGoto(tempwin, 3, 0); twPrint(tempwin, "þ");

	twColor(tempwin, wnp->props.bfcolor, wnp->props.bcolor);
	if(wnp->props.chsize){

			/* imprime el boton de max/rest */

		twGoto(tempwin, wnp->props.vwidth-3, 0);
		twPrint(tempwin, "[ ]");


		twGoto(tempwin, wnp->props.vwidth-2, 0);

		twColor(tempwin, dtp->props.wauxfcolor, wnp->props.bcolor);

		if(wnIsMaxim(wnp)) twPrintf(tempwin,"%c", 18);
		else twPrintf(tempwin, "%c", 24);

			/* imprime el boton de cambio de tama¤o */

		twGoto(tempwin, wnp->props.vwidth+1, wnp->props.vheigth+1);

		twPrint(tempwin, "þ");
		twColor(tempwin, wnp->props.bfcolor, wnp->props.bcolor);

	}

		/* imprime las barras de desplazamiento */

		/* barras horizontales */

	if(wnp->props.rwidth > wnp->props.vwidth){

		wnPrintHBar(dtp, wnp, tempwin);

	}

		/* barras verticales */

	if(wnp->props.rheigth > wnp->props.vheigth){

		wnPrintVBar(dtp, wnp, tempwin);

	}

		/* ahora imprime las sombras */

	twChangeColor(*twpp, wnp->props.x+1, wnp->props.y + wnp->props.vheigth+1, 1, wnp->props.vwidth+2, DARKGRAY, BLACK);

	twChangeColor(*twpp, wnp->props.x + wnp->props.vwidth+1, wnp->props.y, wnp->props.vheigth+1, 2, DARKGRAY, BLACK);


		/* vuelca el contenido del twindow auxiliar */

	tvPos(tempwin, wnp->props.x-1, wnp->props.y-1);

	if(twDump(tempwin, *twpp) == MALROLLO) return MALROLLO;

		/* pone la ventana en su posicion */

	tvPos(wnp->wind, wnp->props.x, wnp->props.y);

		/* pone el tama¤o visual de la ventana */

	tvSize(wnp->wind, wnp->props.vheigth, wnp->props.vwidth);

		/* vuelca el contenido del twindow encima del auxiliar */

	if(twDump(wnp->wind, *twpp) == MALROLLO) return MALROLLO;


		/* elimina el twindow auxiliar */

	twDestroy(&tempwin);

	return NOPROBLEMO;

}


status wnActive(desktop *dtp, win *wnp)

	/* activa una ventana */

	/* al activarla ademas la crea */

{

		/* si no esta correctamente inicializada, devuelve error */

	if(!wnp->initOk) return MALROLLO;


		/* a¤ade la ventana a la lista de ventanas activas */
		/* NOTA: la a¤ade en primer plano */

	if(wlAddItem(&(dtp->wl), wnp, LIST_START) == MALROLLO) return MALROLLO;

		/* actualiza la variable active de wnp */

	wnp->active = TRUE;



		/* inicializa el twindow */

	if(twInit(&(wnp->wind), wnp->props.rheigth, wnp->props.rwidth,
				wnp->props.vheigth, wnp->props.vwidth) == MALROLLO)

		return MALROLLO;

		/* pone la ventana en su posicion */

	tvPos(wnp->wind, wnp->props.x, wnp->props.y);

		/* cambia el color del fondo */

	twColor(wnp->wind, 0, wnp->props.bcolor);
	twClear(wnp->wind);



		/* en este trozo se crearia la ventana */

                /********************************/
		/********* FALTA CODIGO *********/
		/********************************/


		/* refresca el escritorio */

	dtRefresh(dtp);

	return NOPROBLEMO;
}


status wnUnactive(desktop *dtp, int number)

	/* desactiva una ventana */

{


	win *wnp;
	winnode *np;
	int i;
	int listsize;


		/* si la lista de ventanas activas esta vacia, devuelve error */

	if(wlIsEmpty(&(dtp->wl))) return MALROLLO;


		/* calcula el tama¤o de la lista */

	listsize = wlSize(&(dtp->wl));

		/* si se pidio el final de la lista ... */

	if(number == LIST_END) number = listsize - 1;


        	/* si el numero se pasa de la lista devuelve error */

	if(number >= listsize) return MALROLLO;




		/* la busca en la lista de ventanas activas */

	for(i=0, np = dtp->wl.lstart; i < number; i++){

		np = np->next;

	}

		/* si ya esta inactiva devuelve error */

	if(np->winp->active == FALSE) return MALROLLO;

		/* actualiza la variable active de wnp */

	np->winp->active = FALSE;

		/* elimina la memoria que ocupa el twindow */

	twDestroy(&(np->winp->wind));

		/* la borra de la lista */

	if(wlDelItem(&(dtp->wl), &wnp, number) == MALROLLO) return MALROLLO;


		/* refresca el escritorio */

	dtRefresh(dtp);

	return NOPROBLEMO;

}


status wnToFront(desktop *dtp, int number)

	/* trae una ventana activa a primer plano */

{

	int listsize;

		/* si la lista esta vacia devuelve error *

	if(wlIsEmpty(&(dtp->wl))) return MALROLLO;

		/* calcula el tama¤o de la lista */

	listsize = wlSize(&(dtp->wl));

	if(number == LIST_END) number = listsize - 1;


	wlChangePos(&(dtp->wl), number, LIST_START);

	dtRefresh(dtp);

	return NOPROBLEMO;
}


status wnChangeSize(desktop *dtp, int nheigth, int nwidth)

	/* cambia el tama¤o visual de la ventana de 1§ plano */

{

	win *fwptr = dtp->wl.lstart->winp;	/* front window pointer */
	wnprops props;
	int xbuf, ybuf, heigthbuf, widthbuf;

	mouseHide();


		/* consigue las antiguas propiedades de la ventana */

	wnGetProps(fwptr, &props);

		/* actualiza los nuevos valores de alto y ancho */

	if(nheigth != NO_CHANGE) props.vheigth = nheigth;
	if(nwidth != NO_CHANGE) props.vwidth = nwidth;

		/* cambia las propiedades de la ventana con el nuevo tama¤o */

	wnChangeProps(dtp, fwptr, &props);

		/* si el visor estaba desplazado, lo ajusta */

	xbuf = fwptr->wind->viewer.xbuf;
	ybuf = fwptr->wind->viewer.ybuf;

	heigthbuf = fwptr->props.vheigth;
	widthbuf = fwptr->props.vwidth;

	if(xbuf + widthbuf > fwptr->props.rwidth) xbuf = fwptr->props.rwidth - widthbuf;
	if(ybuf + heigthbuf > fwptr->props.rheigth) ybuf = fwptr->props.rheigth - heigthbuf;

	if(tvBufPos(fwptr->wind, xbuf, ybuf) == MALROLLO) {mouseShow(); return MALROLLO;}


		/* copia el fondo sobre el escritorio */

	twCopyBox(dtp->back, dtp->desk, 0, 0);

		/* vuelca la ventana en el escritorio */

	wnDump(dtp, fwptr, TO_DESKTOP);

		/* vuelca el escritorio */

	dtDump(dtp);

	mouseShow();

	return NOPROBLEMO;

}


status wnChangePos(desktop *dtp, int x, int y)

	/* cambia la posicion de la ventana de 1§ plano en el escritorio */

{

	win *fwptr = dtp->wl.lstart->winp;	/* front window pointer */
	wnprops props;


	mouseHide();


	wnGetProps(fwptr, &props);

		/* actualiza los valores de la posicion de restore */

	fwptr->rx = x;
	fwptr->ry = y;

		/* actualiza los nuevos valores de posicion */

	if(x != NO_CHANGE) props.x = x;
	if(y != NO_CHANGE) props.y = y;

		/* cambia las propiedades de la ventana con la nueva posicion */

	wnChangeProps(dtp, fwptr, &props);


		/* copia el fondo sobre el escritorio */

	twCopyBox(dtp->back, dtp->desk, 0, 0);

		/* vuelca la ventana en el escritorio */

	wnDump(dtp, dtp->wl.lstart->winp, TO_DESKTOP);

		/* vuelca el escritorio */

	dtDump(dtp);

	mouseShow();

	return NOPROBLEMO;
}


status wnMaxim(desktop *dtp)

	/* maximiza la ventana de primer plano */

{

	win *fwptr = dtp->wl.lstart->winp;	/* front window pointer */

		/* guarda el tama¤o y la posicion para restaurar */

	fwptr->rvheigth = fwptr->props.vheigth;
	fwptr->rvwidth = fwptr->props.vwidth;
	fwptr->rx = fwptr->props.x;
	fwptr->ry = fwptr->props.y;

		/* ajusta la posicion para que no se salga del escritorio */

		/* si se sale por lo ancho ... */

	if(fwptr->props.rwidth + fwptr->props.x >= dtp->props.width){

		fwptr->props.x = dtp->props.width - fwptr->props.rwidth-1;

	}

		/* ... o si se sale por lo alto ... */

	if(fwptr->props.rheigth + fwptr->props.y >= dtp->props.heigth){

		fwptr->props.y = dtp->props.heigth - fwptr->props.rheigth-1;

	}

	if(wnChangeSize(dtp, fwptr->props.rheigth, fwptr->props.rwidth) == MALROLLO)

		return MALROLLO;


	return NOPROBLEMO;

}


status wnRestore(desktop *dtp)

	/* restaura la ventana de primer plano */

{
	win *fwptr = dtp->wl.lstart->winp;	/* front window pointer */

	if(wnChangeSize(dtp, fwptr->rvheigth, fwptr->rvwidth) == MALROLLO)

		return MALROLLO;

	if(wnChangePos(dtp, fwptr->rx, fwptr->ry) == MALROLLO)

		return MALROLLO;

}


status wnChangeBufPos(desktop *dtp, int x, int y)

	/* cambia la posicion del visor de la ventana de primer plano */

{

	win *fwptr = dtp->wl.lstart->winp;	/* front window pointer */


	mouseHide();

	if(x == NO_CHANGE) x = fwptr->wind->viewer.xbuf;
	if(y == NO_CHANGE) y = fwptr->wind->viewer.ybuf;

	if(x == INC) x = fwptr->wind->viewer.xbuf+1;
	if(y == INC) y = fwptr->wind->viewer.ybuf+1;

	if(x == DEC) x = fwptr->wind->viewer.xbuf-1;
	if(y == DEC) y = fwptr->wind->viewer.ybuf-1;


		/* posibles errores que no detecta tvBufPos */

	if((x < 0) || (y < 0)) { mouseShow(); return MALROLLO; }

	if(tvBufPos(fwptr->wind, x, y) == MALROLLO) {mouseShow(); return MALROLLO;}

		/* copia el fondo sobre el escritorio */

	twCopyBox(dtp->back, dtp->desk, 0, 0);

		/* vuelca la ventana en el escritorio */

	wnDump(dtp, fwptr, TO_DESKTOP);

		/* vuelca el escritorio */

	dtDump(dtp);

	mouseShow();

	return NOPROBLEMO;

}



/*******************************************

	FUNCIONES PARA EL ESCRITORIO

*******************************************/


status dtDump(desktop *dtp)

	/* vuelca el contenido del escritorio en la pantalla */

{
		/* si no esta correctamente inicializado devuelve error */

	if(!dtp->initOk) return MALROLLO;

	if(twDump(dtp->desk, SCREEN) == MALROLLO) return MALROLLO;

	return NOPROBLEMO;
}


status dtRefresh(desktop *dtp)

	/* refresca el contenido del escritorio y lo vuelca a la pantalla */

{
	int i; char lin[VIDEO_WIDTH];
	winnode *np;

		/* si no esta correctamente inicializado, devuelve error */

	if(!dtp->initOk) return MALROLLO;

	mouseHide();

		/* primero crea el fondo ... */

		/* limpia el fondo */

	twColor(dtp->back, dtp->props.nfcolor, dtp->props.nbcolor);

	strrep(lin, dtp->props.width, dtp->props.node);

	twGoto(dtp->back, 0,0);

	for(i=0; i < dtp->props.heigth; i++) twPrint(dtp->back, lin);


		/* si la lista de ventanas activas no esta vacia ... */

	if(!wlIsEmpty(&(dtp->wl))){

			/* recorre la lista de ventanas activas de abajo a arriba */
			/* la ventana de primer plano no la imprime en el fondo */

		for(np = dtp->wl.lend; np->prev != NULL; np = np->prev)

			wnDump(dtp, np->winp, TO_BACKGROUND);

	}

			/* ahora copia el fondo en el escritorio y vuelca la ventana
			de primer plano */

	twCopyBox(dtp->back, dtp->desk, 0, 0);

		/* si la lista de ventanas no esta vacia, imprime la ventana
		de primer plano */

	if(!wlIsEmpty(&(dtp->wl))) wnDump(dtp, np->winp, TO_DESKTOP);

	dtDump(dtp);

	mouseShow();


	return NOPROBLEMO;

}


status dtChangeProps(desktop *dtp, dtprops *pp)

	/* cambia las propiedades del escritorio */

{

	dtprops auxprops;

		/* si se quiere inicializar con las propiedades por defecto ... */

	if(pp == DEFAULT_PROPS){

		auxprops.x = DT_DEF_X;
		auxprops.y = DT_DEF_Y;

		auxprops.heigth = DT_DEF_HEIGTH;
		auxprops.width = DT_DEF_WIDTH;

		auxprops.node = DT_DEF_NODE;

		auxprops.nfcolor = DT_DEF_NFCOLOR;
		auxprops.nbcolor = DT_DEF_NBCOLOR;

		auxprops.wauxfcolor = DT_DEF_WAUXFCOLOR;

	}

		/* ... si no se usan las propiedades dadas */

	else auxprops = *pp;


		/* verifica los posibles errores */

		/* no se permiten escritorios mas grandes que la pantalla */

	if((auxprops.heigth > VIDEO_HEIGTH) || (auxprops.width > VIDEO_WIDTH)) return MALROLLO;

		/* no se permite que el escritorio se salga de la pantalla */

	if(auxprops.x + auxprops.width > VIDEO_WIDTH) return MALROLLO;

	if(auxprops.y + auxprops.heigth > VIDEO_HEIGTH) return MALROLLO;


		/* asigna el nuevo valor para las propiedades */

	dtp->props = auxprops;

	return NOPROBLEMO;

}


status dtInit(desktop *dtp, dtprops *pp)

	/* inicializa el escritorio con las propiedades */

{

	char lin[VIDEO_WIDTH];
	int i;

		/* pone initOk a false de momento (al final se cambiara) */

	dtp->initOk = FALSE;


		/* cambia las propiedades */

	if(dtChangeProps(dtp, pp) == MALROLLO) return MALROLLO;

		/* inicializa los twindow */

	if(twInit(&(dtp->back), dtp->props.heigth, dtp->props.width, dtp->props.heigth, dtp->props.width) == MALROLLO)

		return MALROLLO;

	if(twInit(&(dtp->desk), dtp->props.heigth, dtp->props.width, dtp->props.heigth, dtp->props.width) == MALROLLO)

		return MALROLLO;

		/* actualiza las posiciones */

	tvPos(dtp->back, dtp->props.x, dtp->props.y);
	tvPos(dtp->desk, dtp->props.x, dtp->props.y);

		/* limpia el fondo */

	twColor(dtp->back, dtp->props.nfcolor, dtp->props.nbcolor);

	strrep(lin, dtp->props.width, dtp->props.node);

	for(i=0; i < dtp->props.heigth; i++) twPrint(dtp->back, lin);


		/* copia el fondo 1 en el fondo 2 (inicialmente esto es asi) */

	if(twCopyBox(dtp->back, dtp->desk, 0,0) == MALROLLO) return MALROLLO;

		/* inicializa la lista de ventanas activas */

	wlInit(&(dtp->wl));

		/* si se paso todo, es que se ha inicializado sin problemas */

	dtp->initOk = TRUE;

		/* muestra el escritorio */

	if(dtDump(dtp) == MALROLLO) return MALROLLO;


        return NOPROBLEMO;

}


void dtFree(desktop *dtp)

{

	win *wnp;

		/* inactiva todas las ventanas */

	while(!wlIsEmpty(&(dtp->wl))) wnUnactive(dtp, LIST_START);

		/* imprime el escritorio vacio */

	dtRefresh(dtp);

		/* pone initOk a false */

	dtp->initOk = FALSE;

		/* libera la memoria de los twindow del escritorio */

	twDestroy(&(dtp->back));
	twDestroy(&(dtp->desk));

}


/*********************************************

	FUNCIONES DE EVENTOS DE VENTANAS

*********************************************/


boolean isInDesktop(desktop *dtp, stEvent *step, arEvent *arp)

	/* funcion isin para las ventanas */

{

	int i;
	int x,y;
	int arx, ary, arheigth, arwidth;

	winnode *np;


		/* para abreviar ... */

	x = step->data.mouse.x; y = step->data.mouse.y;

		/* recorre la lista de ventanas activas de arriba a abajo... */

	for(i=0, np = dtp->wl.lstart; np!= NULL; i++, np = np->next){

		arx = np->winp->props.x + dtp->props.x-1;
		ary = np->winp->props.y + dtp->props.y-1;
		arheigth = np->winp->props.vheigth+2;
		arwidth = np->winp->props.vwidth+2;

		if(arx + arwidth > dtp->props.x + dtp->props.width){

			arwidth = dtp->props.x + dtp->props.width - arx ;

		}

		if(ary + arheigth > dtp->props.y + dtp->props.heigth){

			arheigth = dtp->props.y + dtp->props.heigth - ary ;

		}


		if((x >= arx) && (x < arx + arwidth) && (y >= ary) && (y < arheigth + ary)){

			arp->number = i;

			arp->mouse = arp->mouse_ = step->data.mouse;
			arp->mouse.x = x - arx;
			arp->mouse.y = y - ary;

			arp->mouse_.x = x;
			arp->mouse_.y = y;

			return TRUE;

		}
	}


		/* si no hubo evento en una ventana pero si en el escritorio ... */

	if((x >= dtp->props.x) && (x < dtp->props.x + dtp->props.width) &&

	  (y >= dtp->props.y) && (y < dtp->props.y + dtp->props.heigth)){

		arp->number = IN_DESKTOP;

		arp->mouse = arp->mouse_ = step->data.mouse;
		arp->mouse.x = x - dtp->props.x;
		arp->mouse.y = y - dtp->props.y;

		arp->mouse_.x = x;
		arp->mouse_.y = y;

		return TRUE;

	}

	return FALSE;

}


void wnClickInHBar(desktop *dtp, arEvent *arp)

	/* funcion auxiliar a WindowAction para cuando se hace click en la
	barra horizontal */

{

	win *fwptr = dtp->wl.lstart->winp;	/* front window pointer */
	int barwidth, poswidth;
	int posx;
	int x=arp->mouse.x - 2;      /* posicion x relativa a la barra */
	int xbuf, newposx;

	barwidth = fwptr->props.vwidth-4;


		/* calcula los datos de la barra de posicion */

	poswidth = (barwidth * fwptr->props.vwidth) / (fwptr->props.rwidth);

	posx = (barwidth * fwptr->wind->viewer.xbuf) / fwptr->props.rwidth;

		/* ajuste ... */

	if(poswidth == 0) poswidth = 1;

		/* ajuste ... */

	if(fwptr->wind->viewer.xbuf == fwptr->props.rwidth - fwptr->props.vwidth)

		posx = barwidth - poswidth;


	newposx = x - (poswidth / 2);

		/* si se pasa de la longitud de la barra, lo ajusta ... */

	if(x + (poswidth / 2) >= barwidth) newposx = barwidth - poswidth;



	if(x - (poswidth / 2) < 0) newposx = 0;

	xbuf = (newposx * fwptr->props.rwidth) / (barwidth);


		/* ajuste ... */

	if(xbuf + fwptr->wind->viewer.width > fwptr->wind->width)

		xbuf = fwptr->wind->width - fwptr->wind->viewer.width;

	wnChangeBufPos(dtp, xbuf, NO_CHANGE);

}



void wnClickInVBar(desktop *dtp, arEvent *arp)

	/* funcion auxiliar a WindowAction para cuando se hace click en la
	barra vertical */

{

	win *fwptr = dtp->wl.lstart->winp;	/* front window pointer */

	boolean min;
	int barheigth, posheigth;
	int posy;
	int y=arp->mouse.y - 2;      /* posicion x relativa a la barra */
	int ybuf, newposy;

	barheigth = fwptr->props.vheigth-2;


		/* calcula los datos de la barra de posicion */

	posheigth = (barheigth * fwptr->props.vheigth) / (fwptr->props.rheigth);

		/* ajuste ... */

	if(posheigth == 0){

		posheigth = 1;
		min = TRUE;

	}

	posy = (barheigth * fwptr->wind->viewer.ybuf) / fwptr->props.rheigth;

		/* ajuste ... */

	if(fwptr->wind->viewer.ybuf == fwptr->props.rheigth - fwptr->props.vheigth){

		posy = barheigth - posheigth;

		if(min) posy = barheigth-1;

	}


	newposy = y - (posheigth / 2);

		/* si se pasa de la longitud de la barra, lo ajusta ... */

	if(y + (posheigth / 2) >= barheigth-1) newposy = barheigth - posheigth;


	if(y - (posheigth / 2) < 0) newposy = 0;

	ybuf = (newposy * fwptr->props.rheigth) / (barheigth);


		/* ajuste ... */

	if(ybuf + fwptr->wind->viewer.heigth > fwptr->wind->heigth)

		ybuf = fwptr->wind->heigth - fwptr->wind->viewer.heigth;

	wnChangeBufPos(dtp, NO_CHANGE, ybuf);

}



void dtAction(desktop *dtp, arEvent *arp)

{

	int posx, posy;
	static boolean moving;
	static boolean resizing;
	static boolean movBar;
	static boolean inactived;

	static int titlex;
	wnprops fwnp;		/* front window properties */
	int nheigth, nwidth;


		/* asigna el valor de las propiedades de la ventana de 1§ plano */

	fwnp = dtp->wl.lstart->winp->props;

		/* si se hizo click en una ventana sin mover el raton ... */

	if(!moving && !movBar && !resizing && (arp->number != IN_DESKTOP) && (arp->mouse.left) &&
		(arp->number != 0) && !(arp->mouse.move)){

		wnToFront(dtp, arp->number);
		moving = FALSE;
		resizing = FALSE;

	}

		/* si se hizo click en el boton de desactivar ... */

	else if(!moving && !movBar && !resizing && !moving && (arp->mouse.left) && (arp->mouse.y == 0)
		&& (arp->mouse.x >1) && (arp->mouse.x <=4) && (arp->number == 0) &&
		!inactived){

		wnUnactive(dtp, 0);
		inactived = TRUE;	/* se acaba de desactivar una ventana */


	}

		/* si se hizo click en el boton de maximizar / restaurar ... */

	else if(!moving && !movBar && !resizing && !moving && (arp->mouse.left) && (arp->mouse.y == 0)
		&& (arp->mouse.x >fwnp.vwidth-4) && (arp->mouse.x <fwnp.vwidth) &&
		 (arp->number == 0) && (fwnp.chsize)){

		 resizing = TRUE;

		 if(!wnIsMaxim(dtp->wl.lstart->winp)) wnMaxim(dtp);

		 else wnRestore(dtp);

	}

		/* si se hizo click en el boton de cambiar el tama¤o */

	else if(!moving && !movBar && !resizing && (arp->mouse.left) && (arp->mouse.y == fwnp.vheigth+1)
		&& (arp->mouse.x == fwnp.vwidth+1) && (arp->number == 0)
		&& (fwnp.chsize)){

		resizing = TRUE;

	}

		/* si se esta arrastrando el boton de cambio de tama¤o ... */

	else if(!moving && !movBar && resizing && (arp->mouse.left) && (arp->mouse.move)){

		nwidth = arp->mouse_.x - dtp->props.x - fwnp.x;
		nheigth = arp->mouse_.y -dtp->props.y - fwnp.y;

		if((nheigth > fwnp.rheigth) || (nheigth < WN_MIN_VHEIGTH)) nheigth = NO_CHANGE;

		if((nwidth > fwnp.rwidth) || (nwidth < WN_MIN_VWIDTH)) nwidth = NO_CHANGE;

		wnChangeSize(dtp, nheigth, nwidth);

	}

		/* si se hace click en la barra del titulo ... */

	else if(!resizing && !moving && (arp->mouse.y == 0) && (arp->mouse.left) &&
		 (arp->number == 0)){

			/* calcula el offset del raton en el titulo */

		titlex = arp->mouse.x-1;

		moving = TRUE;

	}


		/* si se esta arrastrando el titulo ... */

	else if(!movBar && !resizing && moving && (arp->mouse.left) && (arp->mouse.move)){

		moving = TRUE;

		if(arp->mouse_.x - titlex - dtp->props.x > 0)

			wnChangePos(dtp, arp->mouse_.x - titlex - dtp->props.x, -dtp->props.y + arp->mouse_.y+1);

		else{

			wnChangePos(dtp, NO_CHANGE, -dtp->props.y + arp->mouse_.y+1);
			titlex = arp->mouse_.x-dtp->props.x-1;
		}
	}

		/* si se hizo click en los botones de la barra horizontal ... */
		/* ... boton izquierdo ... */

	else if(!moving && !movBar && !resizing && (arp->mouse.left) && (arp->mouse.x == 2) &&
		(arp->mouse.y == fwnp.vheigth+1)){

			wnChangeBufPos(dtp, DEC, NO_CHANGE);
			delay(16);

	}

		/* ... boton derecho ... */

	else if(!moving && !movBar && !resizing && (arp->mouse.left) && (arp->mouse.x == fwnp.vwidth-1)
		&& (arp->mouse.y == fwnp.vheigth+1)){

			wnChangeBufPos(dtp, INC, NO_CHANGE);
			delay(16);

	}

		/* ... en la misma barra ... */

	else if(!moving && !resizing && (arp->mouse.left) && (arp->mouse.x < fwnp.vwidth-1)
		&& (arp->mouse.x > 2) && (arp->mouse.y == fwnp.vheigth+1) &&
		((arp->mouse.move) || (arp->mouse.butchange))){

			wnClickInHBar(dtp, arp);
			movBar = TRUE;
			delay(16);

	}

		/* si se hizo click en los botones de la barra horizontal ... */
		/* ... boton izquierdo ... */


	else if(!moving && !movBar && !resizing && (arp->mouse.left) && (arp->mouse.x == fwnp.vwidth+1) &&
		(arp->mouse.y == 1)){

			wnChangeBufPos(dtp, NO_CHANGE, DEC);
			delay(60);

	}

		/* ... boton derecho ... */

	else if(!moving && !movBar && !resizing && (arp->mouse.left) && (arp->mouse.x == fwnp.vwidth+1)
		&& (arp->mouse.y == fwnp.vheigth)){

			wnChangeBufPos(dtp, NO_CHANGE, INC);
			delay(60);

	}

		/* ... en la misma barra ... */

	else if(!moving && !resizing && (arp->mouse.left) && (arp->mouse.y < fwnp.vheigth)
		&& (arp->mouse.y > 1) && (arp->mouse.x == fwnp.vwidth+1) &&
		((arp->mouse.move) || (arp->mouse.butchange))){

		wnClickInVBar(dtp, arp);
		movBar = TRUE;
		delay(16);

	}


		/* si moving = TRUE o resizing = TRUE y se deja de hacer click ... */

	else if((moving || resizing || movBar) && !(arp->mouse.left)){

		mouseHide();
		twCopyBox(dtp->back, dtp->desk, 0,0);
		wnDump(dtp, dtp->wl.lstart->winp, TO_DESKTOP);
		dtDump(dtp);
		mouseShow();

		moving = FALSE;
		resizing = FALSE;
		movBar = FALSE;
		inactived = FALSE;

	}

}





/***************************************

	FUNCIONES DE EVENTOS

***************************************/



/*********** FUNCIONES DEL RATON ********************/


status mouseInit()

	/* inicializa el raton */

{

	union REGS r;

	r.x.ax = 0x0;

	int86(0x33, &r, &r);

	if(!r.x.ax) return MALROLLO;

	return NOPROBLEMO;

}


void mouseShow()

	/* muestra el cursor del raton */

{

	union REGS r;

	r.x.ax = 0x1;

	int86(0x33, &r, &r);

}


void mouseHide()

	/* esconde el cursor del raton */

{

	union REGS r;

	r.x.ax = 0x2;

	int86(0x33, &r, &r);

}


boolean mouseGetEvent(mouseEvent *mep)

	/* devuelve la posicion y estado de los botones del raton */
	/* devuelve tambien si ha cambiado el estado respecto del que se da */


{

	union REGS r;
	boolean event = FALSE;
	int right_, left_, both_;

	r.x.ax = 0x3;

	int86(0x33, &r, &r);

	if((r.x.cx / 8 != mep->x) || (r.x.dx / 8 != mep->y)){

		event = TRUE;
		mep->move = TRUE;

	}

	else mep->move = FALSE;

	mep->x = r.x.cx / 8;
	mep->y = r.x.dx / 8;

	r.x.ax = 0x6;
	r.x.bx = 0;

	int86(0x33, &r, &r);

	left_ = mep->left; right_ = mep->right; both_ = mep->both;

	switch(r.x.ax){

		case (0):

			mep->left = mep->right = mep->both = FALSE;
			break;

		case (1):

			mep->right = mep->both = FALSE; mep->left = TRUE;
			break;

		case (2):

			mep->left = mep->both = FALSE; mep->right = TRUE;
			break;

		case (3):

			mep->left = mep->right = FALSE; mep->both = TRUE;
			break;

		default:

			break;

	}

	if(mep->right  || mep->left || mep->both) event = TRUE;

	if((mep->right != right_) || (mep->left != left_) || (mep->both != both_)){

		event = TRUE;
		mep->butchange = TRUE;

	}

	else mep->butchange = FALSE;

	return event;


}


/************* FUNCIONES DE EVENTOS EN GENERAL *******************/


boolean getStEvent(stEvent *step)

	/* obtiene un evento primario */

{

	if(mouseGetEvent(&((step->data).mouse))){

		step->type = MOUSE_EVENT; return TRUE;

	}

	return FALSE;
}


boolean getEvent()

{

	arEvent ar;
	static stEvent ste;

	if(!(getStEvent(&ste))) return FALSE;

	if(ste.type == MOUSE_EVENT){

		if(isInDesktop(&AppDesktop, &ste, &ar))

			dtAction(&AppDesktop, &ar);

	}

	return FALSE;
}




void main()

{

	stEvent ste;
	win w1, w2, w3, w4;
	wnprops props;


	initScreen();

	textbackground(BLACK);clrscr();

	dtInit(&AppDesktop, DEFAULT_PROPS);

	props.title = "Ventana n£mero cuatro";
	props.chsize = TRUE;
	props.vheigth = 7;
	props.vwidth = 30;
	props.rheigth = VIDEO_HEIGTH-8;
	props.rwidth = VIDEO_WIDTH-15;
	props.x = 10; props.y = 10;
	props.tfcolor = WHITE;
	props.bcolor = CYAN;
	props.bfcolor = WHITE;

	wnInit(&AppDesktop, &w1, DEFAULT_PROPS, 1);
	wnInit(&AppDesktop, &w2, DEFAULT_PROPS, 2);
	wnInit(&AppDesktop, &w3, DEFAULT_PROPS, 3);
	wnInit(&AppDesktop, &w4, &props, 4);


	wnGetProps(&w1, &props);
	props.bcolor = RED;
	props.title = "Ventana 1";
	wnChangeProps(&AppDesktop, &w1, &props);

	wnGetProps(&w2, &props);
	props.bcolor = GREEN;
	props.title = "Ventana 2";
	wnChangeProps(&AppDesktop, &w2, &props);

	wnGetProps(&w3, &props);
	props.bcolor = BLUE;
	props.chsize = FALSE;
	props.title = "Ventana 3";
	wnChangeProps(&AppDesktop, &w3, &props);


	mouseInit(); mouseShow();

	wnActive(&AppDesktop, &w1);
	wnActive(&AppDesktop, &w2);
	wnActive(&AppDesktop, &w3);
	wnActive(&AppDesktop, &w4);

	twGoto(AppDesktop.wl.lstart->winp->wind, 0,2);
	twPrintf(AppDesktop.wl.lstart->winp->wind, "  IORX is back. U2 4Ever. Even Better than the Real Thing./n");
	twPrintf(AppDesktop.wl.lstart->winp->wind, "  Zooropa. I want to know God's thoughts, the rest are details./n");
	twPrintf(AppDesktop.wl.lstart->winp->wind, "  12 impresoras color. Las mejores placas para 486 y Pentium/n");
	twColor(AppDesktop.wl.lstart->winp->wind, BLUE, CYAN);
	twPrintf(AppDesktop.wl.lstart->winp->wind, "  IORX is back. U2 4Ever. Even Better than the Real Thing./n");
	twPrintf(AppDesktop.wl.lstart->winp->wind, "  Zooropa. I want to know God's thoughts, the rest are details./n");
	twPrintf(AppDesktop.wl.lstart->winp->wind, "  12 impresoras color. Las mejores placas para 486 y Pentium/n");

	while(!(kbhit())){

		getEvent(&ste);

	}


	dtFree(&AppDesktop);
	mouseHide();

}