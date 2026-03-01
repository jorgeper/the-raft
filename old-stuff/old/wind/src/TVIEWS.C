/****************************************************************************
																														      
	 TVIEWS.C, 23-Agosto-1995. Jorge Pereira
				                                                                                                                                                                                                                                                                   
   Archivo fuente con funciones para manejo de textos en la pantalla         
   mediante ventanas de texto                                                
				                                                                                                                                                                                                                                                                   
****************************************************************************/


#include "tviews.h"

	/* puntero al comienzo de la memoria de video */

unsigned char far *screen;

/*************************************************
																							  
   FUNCIONES DE MANEJO DE LAS VENTANAS DE TEXTO   
																							  
*************************************************/


status twInit(twin **twpp, u_int wHeigth, u_int wWidth, u_int vHeigth, u_int vWidth)

	/* inicializa la ventana de texto */
	/* heigth, width: dimensiones del buffer de texto */
	/* vHeigth, vWidth: dimensiones de la ventana de visualizacion */

{
	u_int wfHeigth, wfWidth;        /* valores finales de ancho y alto del twin */
	u_int vfHeigth, vfWidth;        /* valores finales de ancho y alto del tview */

		/* elige los valores de dimensiones para el twin ... */

	(wHeigth!=DEFAULT) ? (wfHeigth = wHeigth) : (wfHeigth = TWIN_DEF_HEIGTH);
	(wWidth!=DEFAULT) ? (wfWidth = wWidth) : (wfWidth = TWIN_DEF_WIDTH);

		/* ... y para el tview */

	(vHeigth==DEFAULT) ? (vfHeigth = TVIEW_DEF_HEIGTH) : (vfHeigth = vHeigth);
	(vWidth==DEFAULT) ? (vfWidth = TVIEW_DEF_WIDTH) : (vfWidth = vWidth);

		/* posibles errores */
		/* el tviewer no puede ser mayor que la pantalla */

	if((vfHeigth > VIDEO_HEIGTH) || (vfWidth > VIDEO_WIDTH)) return MALROLLO;

		/* las dimensiones del tviewer deben ser menores que el twin */

	if((wfHeigth < vfHeigth) || (wfWidth < vfWidth)) return MALROLLO;

		/* el twin no puede sobrepasar las dimensiones maximas */

	if((long)wWidth*wHeigth > TWIN_MAX_SIZE) return MALROLLO;


		/* reserva memoria para el twin (dinamico) */

	if((*twpp = (twin *)malloc(sizeof(twin))) == NULL)
		
		return MALROLLO;

		/* reserva memoria para el buffer de texto */

	if((((*twpp)->buffer) = (byte *)malloc(sizeof(byte)*wfHeigth*wfWidth*2)) == NULL){
		free(*twpp);
		return MALROLLO;
	}

		/* inicializa las variables de alto y ancho del twin ... */

	(*twpp)->heigth = wfHeigth;
	(*twpp)->width = wfWidth;

		/* ... y alto y ancho del tview */

	((*twpp)->viewer).heigth = vfHeigth;
	((*twpp)->viewer).width = vfWidth;


		/* inicializa las demas variables de la pantalla */

	(*twpp)->bcolor = TWIN_DEF_BCOLOR;
	(*twpp)->fcolor = TWIN_DEF_FCOLOR;
	(*twpp)->xcur = TWIN_DEF_XCUR;
	(*twpp)->ycur = TWIN_DEF_YCUR;

		/* inicializa las variables del visor
		   el visor abarca todo el twin al principio */

		/* coordenadas del visor en el buffer y en la pantalla por defecto */

	((*twpp)->viewer).xbuf = ((*twpp)->viewer).ybuf = 0;
	((*twpp)->viewer).xscr = TVIEW_DEF_XSCR;
	((*twpp)->viewer).yscr = TVIEW_DEF_YSCR;

		/* limpia el buffer de texto */

	twClear(*twpp);

	return NOPROBLEMO;

}



status twDestroy(twin **twpp)

	/* libera la memoria que ocupa un twin */

{

		/* libera la memoria del buffer de texto */

	free((*twpp)->buffer);

		/* libera la memoria del twin (dinamico) */

	free(*twpp);

	return NOPROBLEMO;

}


status twPrint(twin *twp, char *text)

	/* imprime un texto en un twin */

{

	u_int i,j;
	byte attr;
	u_int start;
	u_int size;

		/* calcula el offset de comienzo del texto en el twin */

	start = (twp->ycur*twp->width + twp->xcur)*2;

		/* calcula el tama¤o del buffer de texto */

	size = twp->heigth*twp->width*2;

		/* si el texto comienza sobrepasando el twin devuelve error */

	if(start > size) return MALROLLO;

		/* vuelca los caracteres al buffer, mientras no encuentre \0 y
		   no se pase del final */

	for(i=0,j=0; text[j] && !((start+i+1) > size); i+=2, j++){

			/* vuelca el caracter de texto */

		twp->buffer[start + i] = text[j];

			/* vuelca el caracter de atributo */

		attr=(twp->bcolor << 4) | twp->fcolor;
		twp->buffer[start + i + 1]=attr;
  }

		/* calcula la nueva posicion del cursor */

	twp->xcur = (start/2 + j)%twp->width;
	twp->ycur = (start/2 + j)/twp->width;

	return NOPROBLEMO;

}


u_int twWherex(twin *twp)

	/* devuelve la posicion x del cursor */

{

	return twp->xcur;

}


u_int twWherey(twin *twp)

	/* devuelve la posicion y del cursor */

{

	return twp->ycur;

}

status twGoto(twin *twp, u_int x, u_int y)

	/* coloca el cursor en una posicion en el twin */

{

		/* comprueba que no sobrepase las dimensiones del buffer */

	if(y*twp->width + x >= twp->width*twp->heigth) return MALROLLO;

		/* comprueba que los valores de x e y esten dentro de lo permitido */

	if((x>=(twp->viewer).width) || (y>=(twp->viewer).heigth)) return MALROLLO;

	twp->xcur=x;
	twp->ycur=y;

	return NOPROBLEMO;

}


status twColor(twin *twp, byte fcolor, byte bcolor)

	/* cambia los colores actuales de un twin */

{

	twp->fcolor=fcolor;
	twp->bcolor=bcolor;

	return NOPROBLEMO;

}



status twClear(twin *twp)

	/* borra un twindow */

{

	char *line;
	int i;

	if((line=(char *)malloc(sizeof(char)*twp->width*2)) == NULL) return MALROLLO;

	for(i=0; i<twp->width*2; i+=2){

		line[i] = 32;
		line[i+1] = (twp->bcolor << 4) | twp->fcolor;
	}

	for(i=0; i<twp->heigth; i++){

		memmove(twp->buffer + twp->width*i*2, line, twp->width*2);

	}

	free(line);

	return NOPROBLEMO;

}


status tvSize(twin *twp, u_int heigth, u_int width)

	/* Cambia el tama¤o del tviewer */

{

		/* el tama¤o del tview debe ser menor que el del twin */

	if((twp->heigth < (twp->viewer).heigth) || (twp->width < (twp->viewer).width))

		return MALROLLO;

		/* comprueba si se pidieron los valores por defecto */

	if(heigth == DEFAULT) heigth = TVIEW_DEF_HEIGTH;
	if(width == DEFAULT) width = TVIEW_DEF_WIDTH;

		/* asigna los nuevos valores de alto y ancho */

	(twp->viewer).heigth = heigth;
	(twp->viewer).width = width;


	return NOPROBLEMO;

}


status tvPos(twin *twp, u_int x, u_int y)

	/* Cambia la posicion en pantalla del tviewer */

{

		/* comprueba que no se sale de la pantalla */

	if((x > VIDEO_WIDTH) || (y>VIDEO_HEIGTH)) return MALROLLO;

		/* asigna los nuevos valores */

	(twp->viewer).xscr = x;
	(twp->viewer).yscr = y;

	return NOPROBLEMO;

}


status tvBufPos(twin *twp, u_int x, u_int y)

	/* Cambia la posicion del tviewer en el buffer */

{

		/* comprueba que el rectangulo este dentro del twindow */

	if((x+(twp->viewer).width > twp->width) || (y+(twp->viewer).heigth > twp->heigth))

		return MALROLLO;

		/* asigna los nuevos valores */

	(twp->viewer).xbuf = x;
	(twp->viewer).ybuf = y;

	return NOPROBLEMO;

}


status twDump(twin *source, twin *dest)

	/* vuelca un twin source en otro dest o en la pantalla (SCREEN) */

{

	u_int i;
	u_int scrOffset, bufOffset;
	byte *scrFileStart;
	byte *bufFileStart;
	u_int moveWidth, moveHeigth;

	u_int width, heigth;
	unsigned char far *destPointer;


		/* primero elige si el destino va a ser un twin o la pantalla */

	if(dest == SCREEN){

		width = VIDEO_WIDTH;
		heigth = VIDEO_HEIGTH;

		destPointer = screen;
	}

	else{

		width = dest->width;
		heigth = dest->heigth;

		destPointer = dest->buffer;
	}


		/* calcula los offsets iniciales */
		/* offset en la pantalla ... */

	scrOffset = (width*(source->viewer).yscr + (source->viewer).xscr)*2;

		/* ... y offset en el buffer */

	bufOffset = (source->width*(source->viewer).ybuf + (source->viewer).xbuf)*2;

		/* primero calcula el ancho y alto de texto a mover, por si se sale
			 del destino ... */

		/* ... el ancho ... */

	if((source->viewer).xscr + (source->viewer).width > width)

		moveWidth = (width - (source->viewer).xscr)*2;

	else

		moveWidth = (source->viewer).width*2;

		/* ... y el alto */

	if((source->viewer).yscr + (source->viewer).heigth > heigth)

		moveHeigth = heigth - (source->viewer).yscr;

	else

		moveHeigth = (source->viewer).heigth;



		/* ... y luego vuelca el contenido a la pantalla por lineas */

	for(i=0; i<moveHeigth; i++){

			/* calcula los comienzos de las filas */

		scrFileStart = destPointer + scrOffset + width*2*i;
		bufFileStart = (source->buffer) + bufOffset + (source->width)*2*i;

			/* ... y mueve el texto ... */

		memmove(scrFileStart, bufFileStart, moveWidth);
	}

	return NOPROBLEMO;

}


void initScreen(void)

	/* inicializa el puntero a la memoria de video */

{

		/* crea un puntero a la memoria de video */

	screen=(unsigned char far *)MK_FP(0xb800, 0000);

}


status twPrintf(twin *twp, char *string, ...)

	/* imprime en un twin con formato (parecido al printf de C) */

{

	va_list ap;     /* puntero a la lista de argumentos */
	char *c;
	char num[25];

	char str[2];    /* esta cadena se usar  para pas rsela a twPrint */

	str[1] = '\0';

	va_start(ap, string);

		/* mientras no se acabe la cadena ... */

	for(c=string; *c; c++){

			/* ... si encuentra el caracter % ... */

		if(*c=='%'){

				/* avanza el puntero en la cadena */

			c++;

				/* si llego al final sale */

			if(!(*c)) break;

				/* y si no, elige lo que debe imprimir */

			switch(*c){

					/* double */

				case('f'):

					if(twPrint(twp, gcvt(va_arg(ap, double), 10, num))==MALROLLO) return MALROLLO;

					break;

					/* enteros */

				case('d'):

					if(twPrint(twp, gcvt(va_arg(ap, int), 10, num))==MALROLLO) return MALROLLO;

					break;

					/* cadenas */

				case('s'):

					if(twPrint(twp, va_arg(ap, char *))==MALROLLO) return MALROLLO;

					break;

					/* caracter % */

				case('%'):

					if(twPrint(twp, "%")==MALROLLO) return MALROLLO;

					break;

					/* char */

				case('c'):

					str[0]=va_arg(ap, char);

					if(twPrint(twp, str)==MALROLLO) return MALROLLO;

					break;

				default:

					break;

      }
		}

			/* si encuentra el caracter / */

		else if(*c=='/'){

			c++;

			if(!(*c)) break;

			switch(*c){

					/* caracter / */

				case('/'):

					if(twPrint(twp, "/")==MALROLLO) return MALROLLO;

					break;

					/* salto de linea */

				case('n'):

					if(twGoto(twp, 0, twWherey(twp)+1)==MALROLLO) return MALROLLO;

					break;

				default:

					break;
			}
		}
			/* si no es ni / ni % ... */

		else{

			str[0]=*c;

				/* imprime normalmente el caracter que sea */

			if(twPrint(twp, str)==MALROLLO) return MALROLLO;

		}

	}

	va_end(ap);

	return NOPROBLEMO;

}


char *strrep(char *buffer, u_int rep, char mod)

	/* devuelve una cadena rellena con el car cter mod repetido rep veces */

{

	int i;

	for(i=0; i<rep; i++) buffer[i]=mod;

	buffer[i]='\0';

	return buffer;

}


status twCopyBox(twin *source, twin *dest, u_int x, u_int y)

	/* copia un trozo de source en dest. este trozo ser  del tama¤o de dest
		y empieza en la posicion x,y (esquina sup-izda) de source */

{

	int moveHeigth, moveWidth;
	int i;
	int sstart;
	unsigned char *fsource;
	u_int fsourceHeigth, fsourceWidth;


		/* selecciona los datos finales de buffer y dimensiones */

	if(source == SCREEN){

		fsource = screen;
		fsourceHeigth = VIDEO_HEIGTH;
		fsourceWidth = VIDEO_WIDTH;

	}

	else{

		fsource = source->buffer;
		fsourceHeigth = source->heigth;
		fsourceWidth = source->width;

	}

		/* el destino no puede ser la pantalla */

	if(dest == SCREEN) return MALROLLO;

		/* calcula el offset de comienzo */

	sstart = 2*(fsourceWidth*y +x);


		/* si la caja destino se sale de las dimensiones de la origen, devuelve error */

	if((x > fsourceWidth) || (y > fsourceHeigth)) return MALROLLO;

		/* si la caja destino es mayor que la origen, devuelve error */

	if((dest->width > fsourceWidth) || (dest->heigth > fsourceHeigth)) return MALROLLO;

		/* ajusta las medidas a copiar por si se sale un trozo del origen */

		/* ... el ancho ... */

	if(x + dest->width > fsourceWidth)

		moveWidth = (fsourceWidth - x)*2;

	else

		moveWidth = dest->width*2;

		/* ... y el alto */

	if(y + dest->heigth > fsourceHeigth)

		moveHeigth = fsourceHeigth - y;

	else

		moveHeigth = dest->heigth;

		/* va copiando por lineas de source a dest */

	for(i=0; i < moveHeigth; i++){

		memmove(dest->buffer+(2*i*dest->width),
			fsource + sstart + (2*i*fsourceWidth),
			moveWidth);

	}

	return NOPROBLEMO;

}


status twChangeColor(twin *twp, u_int x, u_int y, u_int heigth, u_int width, int fcolor, int bcolor)

	/* cambia el color de un rect ngulo en el twin */

{

		/* offset de comienzo en el buffer del twin */

	int bstart;
	int offset;     /* desplazamiento que se suma a cada l¡nea */
	int i, j;
	byte attr=(bcolor << 4) | fcolor;
	int moveHeigth, moveWidth;

	unsigned char far *fdest;
	u_int fdestWidth, fdestHeigth;

		/* primero selecciona si el destino es la pantalla (SCREEN) o un twindow */

	if(twp == SCREEN){

		fdest = screen;
		fdestWidth = VIDEO_WIDTH;
		fdestHeigth = VIDEO_HEIGTH;

	}

	else{

		fdest = twp->buffer;
		fdestWidth = twp->width;
		fdestHeigth = twp->heigth;

	}

		/* offset de comienzo en el buffer */

	bstart= 2*(fdestWidth*y + x)+1;  /* NOTA: se suma 1 para que las posiciones
																	 sean las impares */

		/* comprueba que no se sale del destino */

	if((x > fdestWidth) || (y > fdestHeigth)) return MALROLLO;

		/* ajusta las medidas a copiar por si se sale un trozo del twin */

		/* ... el ancho ... */

	if(x + width > fdestWidth)

		moveWidth = (fdestWidth - x)*2;

	else

		moveWidth = width*2;

		/* ... y el alto */

	if(y + heigth > fdestHeigth)

		moveHeigth = fdestHeigth - y;

	else

		moveHeigth = heigth;


		/* c lculo del offset */

	offset = fdestWidth*2;

		/* copia el nuevo valor de attr en las posiciones impares */

	for(i=0; i < moveHeigth; i++){

		for(j=0; j < moveWidth; j+=2){

			*(fdest + bstart + offset*i + j) = attr;

		}
  }

	return NOPROBLEMO;

}


