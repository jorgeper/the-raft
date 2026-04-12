export interface Group {
  name: string;
  colors: string[];
}

export interface SheetData {
  name: string;
  columns: Group[][];
}

export interface Sheet {
  id: string;
  data: SheetData;
  shareToken: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SharedSheet {
  data: SheetData;
  app: string;
  userId: string;
}
