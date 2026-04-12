import { BrowserRouter, Routes, Route } from "react-router-dom";
import { SheetsList } from "./pages/SheetsList";
import { SheetEditor } from "./pages/SheetEditor";
import { SharedView } from "./pages/SharedView";

export function App() {
  return (
    <BrowserRouter basename="/valheim-colors">
      <Routes>
        <Route path="/" element={<SheetsList />} />
        <Route path="/sheets/:id" element={<SheetEditor />} />
        <Route path="/shared/:token" element={<SharedView />} />
      </Routes>
    </BrowserRouter>
  );
}
