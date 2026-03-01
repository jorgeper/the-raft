#include <stdio.h>
#include <stdlib.h>
#include <general.h>
#include <dos.h>

void swap(int a, int b) { int aux=a; a=b; b=aux; }

void w8(void)
{
  char c;
  while (!kbhit());
  c = getchar();
}


