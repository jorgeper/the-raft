#include <clist.h>
#include <stdlib.h>

//--------------------------------------
// nth version 2
// gets a node once given its info field 
//--------------------------------------
clnode *clist::nth (void *info)
{
  clnode *np;
  for (np=start; np && np->info != info; np=np->next);
  return np;
}

//-----------------------------------
// returns the node ptr at position i
//-----------------------------------
clnode *clist::nth (int i)
{
  clnode *np;
  int k;

  if (i>=length || i<0) return NULL;
  for (np=start, k=0; np && k!=i; k++, np=np->next)
        ;
  return np;
}

//-------------------------
// applies f to every node
//-------------------------
void clist::apply (void (*f)(void *info))
{
  clnode *np;
  for (np=start; np; np=np->next) f(np->info);
}

//----------------------------------------------------------
// adds a node after where (if where == NULL then at start)
//----------------------------------------------------------
void *clist::add (clnode *where, void *info)
{
  clnode *newn, *nextn, *prevn;

    // if the list is empty and wanna add at start...
  if (empty())
        {
        if (where) return NULL;
        newn = new clnode (info);
        if (!newn) return NULL; 
        start = end = newn;
        }

    // if adding at start...
  else if (!where)
        {
        nextn = start;
        newn = new clnode (info, NULL, start);
        if (!newn) return NULL;
        start = newn;
        nextn->prev = start;
        }
    
    // else if adding at end...
  else if (where == end)
        {
        prevn = end;
        newn = new clnode (info, end, NULL);
        if (!newn) return NULL;
        end = newn;
        prevn->next = end;
        }
  
    // if adding between two nodes...
  else
        {
        nextn = where->next;
        newn = new clnode (info, where, nextn);
        if (!newn) return NULL;
        where->next = nextn->prev = newn;
        }

  length++;
  return info;
}

//------------------------
// deletes the where node
//------------------------
void *clist::del (clnode *where)
{
  void *info;

  if (!where || empty()) return NULL;

  clnode *prevn = where->prev;
  clnode *nextn = where->next;
  
  info = where->info;
  delete where;

  if (!prevn) start = nextn; else prevn->next = nextn;
  if (!nextn) end = prevn; else nextn->prev = prevn;

  length--;
  return info;
}

