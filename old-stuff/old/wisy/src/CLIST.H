#ifndef _CLIST_H_
#define _CLIST_H_

#include <stdio.h>
#include <stdlib.h>

//////////////////////////
// single list node class
//////////////////////////
class clnode
{
  public:
    void *info;
    clnode *next;
    clnode *prev;

  public:
    clnode(void *info, clnode *prev=NULL, clnode *next=NULL)
        {
        this->info = info;
        this->next = next;
        this->prev = prev;
        };
};

////////////////////////////////////////////////////////////////////
// double linked list class
// NOTES:
// the two basic primitives are add and del. The clnode class must
// be known by the user for using clist. 
// add(clnode, info): adds a node after clnode (NULL for list start)
// del(clnode):       deletes clnode in list
////////////////////////////////////////////////////////////////////
class clist
{
  public:
    clnode *start, *end;        // list start and end
    int    length;              // number of nodes

  // internal
  public:
         clist   (void)  { start = end = NULL; length = 0;}   ;
         ~clist  (void)  { while (!empty()) del (start); }
    
  // interface
  public:
    void *add    (clnode *where, void *info);
    void *del    (clnode *where);
    void *push   (void *info)       { return add (NULL, info); }
    void *pop    (void)             { return del (start); }
    void *append (void *info)       { return add (end, info); }
    void *first (void)             { return start->info; }
    void *last  (void)             { return end->info; }
    int  empty  (void)             { return !start; }
    void apply  (void (*f)(void *));
    clnode *nth (int i);
    clnode *nth (void *info);
};

#endif
